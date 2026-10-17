// Runs plugin code in a child process with a timeout. A plugin that leaves a timer running, loops forever or
// calls process.exit() fails the check instead of hanging ppd or exiting it with code 0.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Paseo gives a plugin process 30 s to initialize (server runtime.ts); evaluation gets the same. */
export const DEFAULT_EVAL_TIMEOUT_MS = 30_000;

export interface EvalRequest {
  target: "server" | "client";
  bundleFile: string;
  pluginDir: string;
  resultFile: string;
  icons: string[] | null;
}

export type WorkerResult =
  | { target: "server"; handlers: string[]; registrations: string[]; evalMs: number; contractErrors: string[] }
  | { target: "client"; contributions: string[]; icons: string[]; setupError: string | null; contractErrors: string[] }
  | { target: "server" | "client"; error: string };

export interface ChildOutcome {
  /** Set when the child was killed after `timeoutMs`. */
  timedOut: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** Spawns a child and waits for it, killing its process group after `timeoutMs`. */
export function runChild(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "ignore", "pipe"], detached: true });
    let stderr = "";
    let timedOut = false;
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString();
    });
    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      // Plugin code may have spawned children of its own; take the whole group down.
      if (!timedOut) kill();
      resolve({ timedOut, code, signal, stderr: stderr.trim() });
    });
  });
}

/** Why a child produced no result, in words a plugin author can act on. */
export function describeNoResult(outcome: ChildOutcome, timeoutMs: number, what: string): string {
  if (outcome.timedOut) return `${what} did not finish within ${Math.round(timeoutMs / 1000)} s (an infinite loop or a blocking call at load or in contribute?)`;
  const how = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
  const tail = outcome.stderr ? `: ${outcome.stderr.split("\n").slice(-3).join(" | ")}` : "";
  return `${what} ended the process before reporting a result (${how}; plugin code calling process.exit or process.kill?)${tail}`;
}

const WORKER = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./eval-worker.ts" : "./eval-worker.js", import.meta.url));

export type EvalOutcome = { ok: true; result: WorkerResult } | { ok: false; error: string };

/** Evaluates a bundle in `eval-worker` under the current Node. */
export async function evaluateIsolated(
  target: "server" | "client",
  bundle: string,
  pluginDir: string,
  options: { timeoutMs?: number; icons?: ReadonlySet<string> | null } = {},
): Promise<EvalOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const work = mkdtempSync(join(tmpdir(), "ppd-eval-"));
  try {
    const request: EvalRequest = {
      target,
      bundleFile: join(work, `${target}.js`),
      pluginDir,
      resultFile: join(work, "result.json"),
      icons: options.icons ? [...options.icons] : null,
    };
    writeFileSync(request.bundleFile, bundle);
    writeFileSync(join(work, "request.json"), JSON.stringify(request));
    const outcome = await runChild(process.execPath, [WORKER, join(work, "request.json")], { cwd: work, timeoutMs });
    if (!existsSync(request.resultFile)) return { ok: false, error: describeNoResult(outcome, timeoutMs, `the ${target} bundle`) };
    return { ok: true, result: JSON.parse(readFileSync(request.resultFile, "utf8")) as WorkerResult };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

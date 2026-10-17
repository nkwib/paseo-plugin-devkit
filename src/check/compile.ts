// Compiling a plugin the way Paseo does. With a Paseo source checkout (PASEO_SOURCE) this runs Paseo's own
// manifest reader, compilePlugin and server bundle evaluator. Without one it uses an esbuild approximation
// of the same build options, which misses Paseo's import-boundary and type-walk checks.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { CLIENT_HOST_MODULES, SDK_SPECIFIERS, SERVER_HOST_MODULES } from "./host.ts";
import { describeNoResult, runChild } from "./isolate.ts";

export type Target = "client" | "server";

export interface Entries {
  client: string | null;
  server: string | null;
}

export function findEntries(pluginDir: string): Entries {
  const pick = (names: string[]) => names.map((name) => join(pluginDir, name)).find(existsSync) ?? null;
  return {
    client: pick(["index.client.tsx", "index.client.ts"]),
    server: pick(["index.server.ts", "index.server.tsx"]),
  };
}

export const PASEO_COMPILER = "packages/server/src/server/plugins/compiler.ts";

export function isPaseoSource(dir: string | undefined): dir is string {
  return Boolean(dir) && existsSync(join(dir!, PASEO_COMPILER)) && existsSync(join(dir!, "node_modules/.bin/tsx"));
}

/** PASEO_SOURCE when it points at a usable checkout (with node_modules), else null. */
export function findPaseoSource(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate = explicit ?? env.PASEO_SOURCE;
  return isPaseoSource(candidate) ? resolve(candidate) : null;
}

export const PASEO_SOURCE_MISSING =
  "set PASEO_SOURCE to a getpaseo/paseo checkout with node_modules installed to compile with Paseo's real compiler";

function wrapCommonJs(code: string): string {
  return `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
}

/** esbuild with the options of Paseo 0.11's compileTarget. Returns the wrapped `(function(require) {...})` bundle. */
export async function compileLikePaseo(entry: string, target: Target): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: target === "server" ? "node" : "neutral",
    target: target === "server" ? "node20" : "es2020",
    ...(target === "client" ? { mainFields: ["module", "main"], supported: { "async-await": false } } : {}),
    external: target === "client" ? [...CLIENT_HOST_MODULES] : [...SERVER_HOST_MODULES, ...SDK_SPECIFIERS],
    logLevel: "silent",
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error(`${target} compilation produced no output`);
  return wrapCommonJs(output.replaceAll("get: () => from[key]", "value: from[key]"));
}

export interface PaseoCompileResult {
  error?: string;
  /** Where Paseo stopped: load (modules), manifest, compile, evaluate (server bundle). */
  stage?: "load" | "manifest" | "compile" | "evaluate";
  clientBundle: string | null;
  serverBundle: string | null;
  handlers: string[];
  registrations: string[];
  evalMs: number | null;
  /** False when the server contribution did not return a cleanup function. Null when not evaluated. */
  returnsCleanup: boolean | null;
}

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/host-compile.mjs");

interface ScriptResult {
  stage: "load" | "manifest" | "compiled" | "compile" | "evaluate" | "done";
  error?: string;
  handlers: string[];
  registrations: string[];
  evalMs: number | null;
  returnsCleanup: boolean | null;
}

/**
 * Runs scripts/host-compile.mjs in a child with a timeout, so Paseo's own modules do the work and plugin code
 * (the server contribution) cannot hang or exit ppd. With a Paseo checkout the runtime is its tsx.
 */
export async function compileWithPaseo(pluginDir: string, paseoSource: string, timeoutMs = DEFAULT_COMPILE_TIMEOUT_MS): Promise<PaseoCompileResult> {
  const plugins = join(paseoSource, "packages/server/src/server/plugins");
  return runHostCompile(join(paseoSource, "node_modules/.bin/tsx"), [SCRIPT, plugins, ".ts", resolve(pluginDir)], { cwd: paseoSource, timeoutMs });
}

/** Compiling dv-sized plugins takes seconds; evaluation inside gets the host's 30 s on top. */
export const DEFAULT_COMPILE_TIMEOUT_MS = 120_000;

async function runHostCompile(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<PaseoCompileResult> {
  const out = mkdtempSync(join(tmpdir(), "ppd-compile-"));
  try {
    const outcome = await runChild(command, [...args, out], { cwd: options.cwd ?? out, ...(options.env ? { env: options.env } : {}), timeoutMs: options.timeoutMs });
    const read = (name: string) => (existsSync(join(out, name)) ? readFileSync(join(out, name), "utf8") : null);
    const raw = read("result.json");
    const result: ScriptResult = raw ? JSON.parse(raw) : { stage: "load", handlers: [], registrations: [], evalMs: null, returnsCleanup: null };
    const base = { clientBundle: read("client.js"), serverBundle: read("server.js"), handlers: result.handlers, registrations: result.registrations, evalMs: result.evalMs, returnsCleanup: result.returnsCleanup };
    if (result.stage === "done") return base;
    if (result.error) return { ...base, stage: result.stage as NonNullable<PaseoCompileResult["stage"]>, error: result.error };
    // No error recorded: the process was killed or exited mid-stage.
    const stage = result.stage === "compiled" ? "evaluate" : result.stage === "load" ? "load" : "compile";
    const what = stage === "evaluate" ? "the server contribution" : `Paseo's ${stage} step`;
    return { ...base, stage, error: describeNoResult(outcome, options.timeoutMs, what) };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

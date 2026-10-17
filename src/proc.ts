import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { delimiter, join } from "node:path";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export function run(command: string, args: readonly string[], options: SpawnSyncOptions = {}): RunResult {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function runOrThrow(command: string, args: readonly string[], options: SpawnSyncOptions = {}): string {
  const result = run(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}

export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function firstExisting(paths: readonly (string | undefined | null)[]): string | null {
  return paths.find((path): path is string => Boolean(path) && existsSync(path!)) ?? null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function processCommand(pid: number): string | null {
  const result = run("ps", ["-o", "command=", "-p", String(pid)]);
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** True when nothing accepts TCP connections on 127.0.0.1:port and the port can be bound. */
export async function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  const connected = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
  if (connected) return false;
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(probe: () => Promise<T | null> | T | null, timeoutMs: number, intervalMs = 500): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== undefined) return value;
    await sleep(intervalMs);
  }
  return null;
}

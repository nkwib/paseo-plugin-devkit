// Locating the Paseo CLI and web UI build on this machine, and calling the CLI against a dev daemon.
import { homedir } from "node:os";
import { join } from "node:path";
import { firstExisting, run, which, type RunResult } from "./proc.ts";
import { devDaemonEnv, paseoArgsForHome } from "./safety.ts";

export function findPaseoBin(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return firstExisting([
    explicit,
    env.PASEO_BIN,
    which("paseo", env),
    join(homedir(), ".local/bin/paseo"),
    "/Applications/Paseo.app/Contents/Resources/bin/paseo",
  ]);
}

export function paseoVersion(bin: string): string | null {
  const result = run(bin, ["--version"], { timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim().split("\n").pop() ?? null : null;
}

/** A static Paseo web export: the desktop app ships one, or build one from source with `npm run build:daemon-web-ui`. */
export function findWebDist(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    explicit,
    env.PASEO_WEB_UI_DIST_DIR,
    "/Applications/Paseo.app/Contents/Resources/app-dist",
    join(homedir(), "Applications/Paseo.app/Contents/Resources/app-dist"),
  ];
  return firstExisting(candidates.map((dir) => (dir ? join(dir, "index.html") : null)))?.replace(/[\\/]index\.html$/, "") ?? null;
}

export function runPaseo(bin: string, home: string, args: readonly string[], options: { timeoutMs?: number; inherit?: boolean } = {}): RunResult {
  return run(bin, paseoArgsForHome(args, home), {
    env: devDaemonEnv(process.env, home),
    timeout: options.timeoutMs ?? 300_000,
    ...(options.inherit ? { stdio: "inherit" } : {}),
  });
}

// Install a plugin directory into the dev daemon, as a directory source or as a file:// Git source.
// Git mode installs the committed HEAD, so it runs the manifest `build` exactly like a registry install.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireDaemon } from "./daemon.ts";
import { runPaseo } from "./paseo.ts";
import { run } from "./proc.ts";

export interface InstallOptions {
  name?: string;
  id?: string;
  git?: boolean;
  log?: (line: string) => void;
}

export interface InstallResult {
  id: string;
  status: string;
  error: string | null;
  logs: string;
}

export function readManifest(dir: string): { id: string; [key: string]: unknown } {
  const path = resolve(dir, "paseo-plugin.json");
  if (!existsSync(path)) throw new Error(`${dir} has no paseo-plugin.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function installSource(dir: string, git: boolean): string {
  return git ? pathToFileURL(resolve(dir)).href : resolve(dir);
}

export function pluginEntry(list: unknown, id: string): { status?: string; error?: string | null } | null {
  const entries = Array.isArray(list) ? list : (list as { plugins?: unknown[] } | null)?.plugins ?? [list];
  const found = entries.find((entry) => (entry as { id?: string } | null)?.id === id);
  return (found as { status?: string; error?: string | null }) ?? null;
}

export function installPlugin(dir: string, options: InstallOptions = {}): InstallResult {
  const log = options.log ?? console.log;
  const daemon = requireDaemon(options.name);
  const manifest = readManifest(dir);
  const id = options.id ?? (options.git ? `${manifest.id}-git` : manifest.id);
  if (options.git) {
    const dirty = run("git", ["status", "--porcelain"], { cwd: resolve(dir) }).stdout.trim();
    if (dirty) log("note: Git mode installs the committed HEAD; uncommitted changes are not included");
  }
  const source = installSource(dir, Boolean(options.git));
  const shown = options.git ? source : relative(process.cwd(), source) || ".";
  log(`installing ${shown} as ${id} into ${daemon.url}`);
  const install = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "install", source, "--id", id, "--json"], { timeoutMs: 900_000 });
  const listed = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "ls", id, "--json"], { timeoutMs: 60_000 });
  let entry: ReturnType<typeof pluginEntry> = null;
  try {
    entry = pluginEntry(JSON.parse(listed.stdout), id);
  } catch {}
  const logs = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "logs", id], { timeoutMs: 60_000 }).stdout;
  const status = install.status !== 0 ? "install-failed" : entry?.status ?? "unknown";
  const error = install.status !== 0 ? (install.stderr || install.stdout).trim() : entry?.error ?? null;
  return { id, status, error, logs };
}

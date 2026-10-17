// Install a plugin directory into the dev daemon, as a directory source or as a file:// Git source.
// Git mode installs the committed HEAD, so it runs the manifest `build` exactly like a registry install.
// Installing an id that is already configured reloads it (same directory) or replaces it, so the edit loop
// can run `ppd install` repeatedly.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkClient } from "./check/index.ts";
import { requireDaemon, type DaemonRecord } from "./daemon.ts";
import { runPaseo } from "./paseo.ts";
import { gitLocation } from "./git.ts";
import { run } from "./proc.ts";

export interface InstallOptions {
  name?: string;
  id?: string;
  git?: boolean;
  log?: (line: string) => void;
}

export interface InstallResult {
  id: string;
  /** The daemon's plugin status ("running", ...), "install-failed", or "client-rejected" when the app would not evaluate the client. */
  status: string;
  action: "installed" | "reloaded" | "replaced";
  error: string | null;
  logs: string;
  /** Registration errors that make the app drop the whole plugin client (unknown icon, bad id, ...). */
  clientErrors: string[];
  clientNotes: string[];
}

export function readManifest(dir: string): { id: string; [key: string]: unknown } {
  const path = resolve(dir, "paseo-plugin.json");
  if (!existsSync(path)) throw new Error(`${dir} has no paseo-plugin.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Directory installs use the path; Git installs use the repository root (a subdirectory is not a Git repository). */
export function installSource(dir: string, git: boolean): string {
  if (!git) return resolve(dir);
  return pathToFileURL(gitLocation(dir)?.root ?? resolve(dir)).href;
}

/** `paseo plugin install` arguments: the source, plus --path for a plugin in a subdirectory of its repository. */
export function installArgs(dir: string, git: boolean): string[] {
  const sub = git ? gitLocation(dir)?.path : "";
  return [installSource(dir, git), ...(sub ? ["--path", sub] : [])];
}

interface PluginEntry {
  id?: string;
  status?: string;
  error?: string | null;
  path?: string;
  installation?: { identity?: { kind?: string; path?: string } };
}

export function pluginEntry(list: unknown, id: string): PluginEntry | null {
  const entries = Array.isArray(list) ? list : (list as { plugins?: unknown[] } | null)?.plugins ?? [list];
  const found = entries.find((entry) => (entry as { id?: string } | null)?.id === id);
  return (found as PluginEntry) ?? null;
}

function listedPlugin(daemon: DaemonRecord, id: string): PluginEntry | null {
  const listed = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "ls", "--json"], { timeoutMs: 60_000 });
  try {
    return pluginEntry(JSON.parse(listed.stdout), id);
  } catch {
    return null;
  }
}

/** A directory install of exactly this directory can be reloaded in place; anything else is replaced. */
export function canReload(entry: PluginEntry, dir: string, git: boolean): boolean {
  const kind = entry.installation?.identity?.kind ?? "directory";
  const path = entry.installation?.identity?.path ?? entry.path;
  return !git && kind === "directory" && path !== undefined && resolve(path) === resolve(dir);
}

/** The message of a `paseo ... --json` failure (`{"error":{"message":...}}`), else the raw output. */
export function cliErrorMessage(output: string): string {
  const text = output.trim();
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message.replace(/^Request failed: /, "").replace(/ requestType=\S+ code=\S+$/, "");
  } catch {}
  return text;
}

export async function installPlugin(dir: string, options: InstallOptions = {}): Promise<InstallResult> {
  const log = options.log ?? console.log;
  const daemon = requireDaemon(options.name);
  const manifest = readManifest(dir);
  const git = Boolean(options.git);
  const id = options.id ?? (git ? `${manifest.id}-git` : manifest.id);
  if (git) {
    const dirty = run("git", ["status", "--porcelain"], { cwd: resolve(dir) }).stdout.trim();
    if (dirty) log("note: Git mode installs the committed HEAD; uncommitted changes are not included");
  }
  const args = installArgs(dir, git);
  const source = args[0]!;
  const local = relative(process.cwd(), source) || ".";
  const shown = `${git || local.startsWith("..") ? source : local}${args[2] ? ` (path ${args[2]})` : ""}`;
  const existing = listedPlugin(daemon, id);
  let action: InstallResult["action"] = "installed";
  let step;
  if (existing && canReload(existing, dir, git)) {
    action = "reloaded";
    log(`reloading ${id} from ${shown} in ${daemon.url}`);
    step = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "reload", id, "--json"], { timeoutMs: 900_000 });
  } else {
    if (existing) {
      action = "replaced";
      log(`replacing the configured ${id}`);
      const removed = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "remove", id, "--json"], { timeoutMs: 120_000 });
      if (removed.status !== 0) throw new Error(`could not remove the configured ${id}: ${(removed.stderr || removed.stdout).trim()}`);
    }
    log(`installing ${shown} as ${id} into ${daemon.url}`);
    step = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "install", ...args, "--id", id, "--json"], { timeoutMs: 900_000 });
  }
  const entry = listedPlugin(daemon, id);
  const logs = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "logs", id], { timeoutMs: 60_000 }).stdout;
  const failed = step.status !== 0;
  let status = failed ? "install-failed" : entry?.status ?? "unknown";
  const error = failed ? cliErrorMessage(step.stderr || step.stdout) : entry?.error ?? null;
  // The daemon only knows about the server half. The app evaluates the client and reports a failure as a
  // console warning nobody sees, so check the client against the app's rules here.
  const client = failed ? null : await checkClient(dir);
  if (client?.errors.length && status === "running") status = "client-rejected";
  return { id, status, action, error, logs, clientErrors: client?.errors ?? [], clientNotes: client?.notes ?? [] };
}

/** `ppd install` output lines for a result. */
export function formatInstall(result: InstallResult): string {
  const lines = [`${result.id}: ${result.status} (${result.action})${result.error ? `\n${result.error}` : ""}`];
  if (result.clientErrors.length) {
    lines.push("client: the app would not evaluate this plugin's client, so none of its UI appears:", ...result.clientErrors.map((error) => `  ${error}`));
  } else if (result.status === "running") {
    lines.push("client: passes the app's registration rules");
  }
  lines.push(...result.clientNotes.map((note) => `  note: ${note}`));
  if (result.logs.trim()) lines.push(`--- plugin logs\n${result.logs.trim()}`);
  return lines.join("\n");
}

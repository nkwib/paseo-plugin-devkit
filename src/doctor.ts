// `ppd doctor`: what this machine can do for plugin development. Read-only.
import { existsSync, statfsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findAdb } from "./android.ts";
import { findHermes } from "./check/hermes.ts";
import { isDaemonLive, listDaemons } from "./daemon.ts";
import { findPaseoBin, findWebDist, paseoVersion } from "./paseo.ts";
import { run, which } from "./proc.ts";

export type Level = "ok" | "warn" | "missing";

export interface DoctorItem {
  name: string;
  level: Level;
  detail: string;
}

export const MIN_NODE = [22, 18] as const;
/** An iOS simulator build of Paseo needed ~15 GB free in practice (build products, Pods, simulator data). */
export const IOS_BUILD_FREE_BYTES = 15 * 1024 ** 3;

export function nodeVersionOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function freeBytes(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function firstLine(command: string, args: string[]): string | null {
  const bin = which(command);
  if (!bin) return null;
  const result = run(bin, args, { timeout: 20_000 });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split("\n")[0] ?? null : null;
}

export function collectDoctor(): DoctorItem[] {
  const items: DoctorItem[] = [];
  const add = (name: string, level: Level, detail: string) => items.push({ name, level, detail: detail.split(homedir()).join("~") });

  add("node", nodeVersionOk(process.version) ? "ok" : "warn", `${process.version} (need >= ${MIN_NODE.join(".")})`);
  const paseo = findPaseoBin();
  const version = paseo ? paseoVersion(paseo) : null;
  add("paseo CLI", paseo ? "ok" : "missing", paseo ? `${version ?? "unknown version"} at ${paseo.replace(homedir(), "~")}` : "install Paseo or set PASEO_BIN");
  const webDist = findWebDist();
  add("web UI build", webDist ? "ok" : "warn", webDist ?? "no app-dist found; pass --web-dist to `ppd daemon up`");
  const source = process.env.PASEO_SOURCE;
  add(
    "PASEO_SOURCE",
    source && existsSync(join(source, "packages/server/src/server/plugins/compiler.ts")) ? "ok" : "warn",
    source ? source.replace(homedir(), "~") : "unset: `ppd check` falls back to an esbuild approximation of the compiler",
  );
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
  add("browser", chrome || process.env.PPD_BROWSER ? "ok" : "warn", process.env.PPD_BROWSER ?? chrome ?? "no Chrome: run `npx playwright-core install chromium` or set PPD_BROWSER");
  const hermes = findHermes(process.cwd());
  add("hermesc", hermes.hermesc ? "ok" : "warn", hermes.hermesc?.replace(homedir(), "~") ?? "not found: Hermes checks skip (install react-native in the plugin, or set HERMESC)");
  const adb = findAdb();
  add("adb", adb ? "ok" : "warn", adb ? (firstLine(adb, ["version"]) ?? adb) : "not found: Android device checks unavailable");
  if (process.platform === "darwin") {
    const xcode = run("xcodebuild", ["-version"], { timeout: 20_000 });
    add("Xcode", xcode.status === 0 ? "ok" : "warn", xcode.status === 0 ? xcode.stdout.trim().replace(/\n/g, ", ") : "not installed: no iOS simulator builds");
    const simctl = run("xcrun", ["simctl", "help"], { timeout: 20_000 });
    add("simctl", simctl.status === 0 ? "ok" : "warn", simctl.status === 0 ? "available" : "unavailable");
  }
  add("git", which("git") ? "ok" : "missing", firstLine("git", ["--version"]) ?? "install git");
  const gh = which("gh");
  add("gh", gh ? "ok" : "warn", gh ? (firstLine("gh", ["--version"]) ?? "present") : "not found: `ppd release` and `ppd registry update --yes` need it");
  for (const [label, path] of [["disk (temp)", tmpdir()], ["disk (home)", homedir()]] as const) {
    const free = freeBytes(path);
    if (free === null) continue;
    add(label, free >= IOS_BUILD_FREE_BYTES ? "ok" : "warn", `${formatBytes(free)} free${free < IOS_BUILD_FREE_BYTES ? " (an iOS simulator build needs ~15 GB)" : ""}`);
  }
  const daemons = listDaemons();
  add(
    "dev daemons",
    "ok",
    daemons.length ? daemons.map((d) => `${d.name} ${d.url} ${isDaemonLive(d) ? "running" : "stale"}`).join("; ") : "none",
  );
  return items;
}

export async function doctorCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true });
  const items = collectDoctor();
  if (values.json) {
    console.log(JSON.stringify(items, null, 2));
  } else {
    const width = Math.max(...items.map((item) => item.name.length));
    for (const item of items) console.log(`${item.level.padEnd(7)} ${item.name.padEnd(width)}  ${item.detail}`);
  }
  return items.some((item) => item.level === "missing") ? 1 : 0;
}

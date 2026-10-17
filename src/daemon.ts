// Isolated Paseo dev daemons: temp home, safe port, plugins on, web UI on, detached with a pidfile
// so agent harness time limits cannot kill them. `down` signals only the process group it started.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { findPaseoBin, findWebDist, paseoVersion, runPaseo } from "./paseo.ts";
import { isPidAlive, isPortFree, processCommand, run, sleep, waitFor, which } from "./proc.ts";
import {
  assertSafeHome,
  assertSafePort,
  canonicalPath,
  commandUsesHome,
  DEFAULT_PORT_RANGE,
  devDaemonEnv,
  HOME_MARKER,
  REAL_DAEMON_PORT,
  SafetyError,
} from "./safety.ts";

export interface DaemonRecord {
  name: string;
  pid: number;
  port: number;
  home: string;
  url: string;
  paseoBin: string;
  paseoVersion: string | null;
  webDist: string | null;
  startedAt: string;
  caffeinatePid?: number;
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PPD_STATE_DIR) return env.PPD_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "paseo-plugin-devkit");
}

function recordPath(name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new SafetyError(`invalid daemon name: ${name}`);
  return join(stateDir(), "daemons", `${name}.json`);
}

export function readDaemon(name = "default"): DaemonRecord | null {
  const path = recordPath(name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DaemonRecord) : null;
}

export function listDaemons(): DaemonRecord[] {
  const dir = join(stateDir(), "daemons");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as DaemonRecord);
}

function writeDaemon(record: DaemonRecord): void {
  mkdirSync(join(stateDir(), "daemons"), { recursive: true });
  writeFileSync(recordPath(record.name), `${JSON.stringify(record, null, 2)}\n`);
}

function forgetDaemon(name: string): void {
  rmSync(recordPath(name), { force: true });
}

/** The config.json written into a dev home. Relay and MCP stay off; speech is off so no models download. */
export function buildDaemonConfig(listen: string, webDist: string | null): object {
  return {
    version: 1,
    daemon: { listen, relay: { enabled: false }, mcp: { enabled: false } },
    features: {
      dictation: { enabled: false },
      voiceMode: { enabled: false },
      ...(webDist ? { webUi: { enabled: true, distDir: webDist } } : {}),
    },
    pluginsEnabled: true,
  };
}

export async function pickPort(requested: number | undefined, isFree: (port: number) => Promise<boolean> = isPortFree): Promise<number> {
  if (requested !== undefined) {
    assertSafePort(requested);
    if (!(await isFree(requested))) throw new SafetyError(`port ${requested} is already in use`);
    return requested;
  }
  for (let port = DEFAULT_PORT_RANGE.first; port <= DEFAULT_PORT_RANGE.last; port++) {
    if (port === REAL_DAEMON_PORT) continue;
    if (await isFree(port)) return port;
  }
  throw new SafetyError(`no free port in ${DEFAULT_PORT_RANGE.first}-${DEFAULT_PORT_RANGE.last}; pass --port`);
}

/** Live means the pid is alive and its command line names this record's home. */
export function isDaemonLive(record: DaemonRecord): boolean {
  if (!isPidAlive(record.pid)) return false;
  const command = processCommand(record.pid);
  return command !== null && commandUsesHome(command, record.home);
}

async function httpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

export interface UpOptions {
  name?: string;
  port?: number;
  paseo?: string;
  webDist?: string;
  workspace?: string;
  caffeinate?: boolean;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export async function daemonUp(options: UpOptions = {}): Promise<DaemonRecord> {
  const name = options.name ?? "default";
  const log = options.log ?? console.log;
  const existing = readDaemon(name);
  if (existing && isDaemonLive(existing)) {
    log(`dev daemon "${name}" already running at ${existing.url} (pid ${existing.pid})`);
    return existing;
  }
  if (existing) forgetDaemon(name);

  const paseoBin = findPaseoBin(options.paseo);
  if (!paseoBin) throw new Error("Paseo CLI not found: install Paseo, put `paseo` on PATH, or pass --paseo / PASEO_BIN");
  const port = await pickPort(options.port);
  const webDist = findWebDist(options.webDist);
  const home = assertSafeHome(mkdtempSync(join(canonicalPath(tmpdir()), `ppd-${name}-`)));
  writeFileSync(join(home, HOME_MARKER), `created by paseo-plugin-devkit for daemon "${name}"\n`);
  const listen = `127.0.0.1:${port}`;
  writeFileSync(join(home, "config.json"), `${JSON.stringify(buildDaemonConfig(listen, webDist), null, 2)}\n`);

  const out = openSync(join(home, "daemon.out"), "a");
  const child = spawn(paseoBin, ["daemon", "run", "--home", home], {
    detached: true,
    stdio: ["ignore", out, out],
    env: devDaemonEnv(process.env, home, {
      PASEO_LISTEN: listen,
      ...(webDist ? { PASEO_WEB_UI_ENABLED: "true", PASEO_WEB_UI_DIST_DIR: webDist } : {}),
    }),
  });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn the Paseo daemon");
  writeFileSync(join(home, "ppd.pid"), `${child.pid}\n`);

  const record: DaemonRecord = {
    name,
    pid: child.pid,
    port,
    home,
    url: `http://${listen}`,
    paseoBin,
    paseoVersion: paseoVersion(paseoBin),
    webDist,
    startedAt: new Date().toISOString(),
  };
  writeDaemon(record);

  const ready = await waitFor(async () => {
    if (!isPidAlive(child.pid!)) throw new Error(`dev daemon exited early:\n${tail(join(home, "daemon.out"))}`);
    return (await httpReady(`${record.url}/`)) ? true : null;
  }, options.timeoutMs ?? 90_000).catch(async (error: Error) => {
    await daemonDown({ name, log: () => {} });
    throw error;
  });
  if (!ready) {
    const output = tail(join(home, "daemon.out"));
    await daemonDown({ name, log: () => {} });
    throw new Error(`dev daemon did not become ready on ${listen}:\n${output}`);
  }

  if (options.caffeinate && process.platform === "darwin" && which("caffeinate")) {
    const keepAwake = spawn("caffeinate", ["-dims", "-w", String(child.pid)], { detached: true, stdio: "ignore" });
    keepAwake.unref();
    if (keepAwake.pid) record.caffeinatePid = keepAwake.pid;
    writeDaemon(record);
  }

  if (options.workspace) {
    const result = runPaseo(paseoBin, home, ["workspace", "create", "--isolation", "local", "--path", options.workspace, "--json"]);
    if (result.status !== 0) log(`warning: could not create a workspace for ${options.workspace}: ${result.stderr.trim()}`);
    else log(`workspace created for ${options.workspace}`);
  }

  log(`dev daemon "${name}" up`);
  log(`  url:   ${record.url}${webDist ? "" : " (no web UI build found: pass --web-dist)"}`);
  log(`  home:  ${home}`);
  log(`  pid:   ${record.pid}`);
  log(`  paseo: ${record.paseoVersion ?? "unknown version"}`);
  return record;
}

function tail(file: string, lines = 30): string {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

export interface DownOptions {
  name?: string;
  keepHome?: boolean;
  log?: (line: string) => void;
}

export async function daemonDown(options: DownOptions = {}): Promise<boolean> {
  const name = options.name ?? "default";
  const log = options.log ?? console.log;
  const record = readDaemon(name);
  if (!record) {
    log(`no dev daemon "${name}" recorded`);
    return false;
  }
  const home = assertSafeHome(record.home);
  if (isDaemonLive(record)) {
    signalGroup(record.pid, "SIGTERM");
    const stopped = await waitFor(() => (isPidAlive(record.pid) ? null : true), 15_000, 250);
    if (!stopped) signalGroup(record.pid, "SIGKILL");
    await sleep(250);
    log(`stopped dev daemon "${name}" (pid ${record.pid})`);
  } else if (isPidAlive(record.pid)) {
    log(`pid ${record.pid} is alive but is not this dev daemon; not signalling it`);
  }
  if (record.caffeinatePid && isPidAlive(record.caffeinatePid) && processCommand(record.caffeinatePid)?.includes("caffeinate")) {
    process.kill(record.caffeinatePid, "SIGTERM");
  }
  if (!options.keepHome && existsSync(join(home, HOME_MARKER))) {
    rmSync(home, { recursive: true, force: true });
    log(`removed ${home}`);
  } else if (options.keepHome) {
    log(`kept ${home}`);
  }
  forgetDaemon(name);
  return true;
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export interface DaemonStatus {
  record: DaemonRecord;
  live: boolean;
  http: boolean;
  plugins: unknown;
}

export async function daemonStatus(name = "default"): Promise<DaemonStatus | null> {
  const record = readDaemon(name);
  if (!record) return null;
  const live = isDaemonLive(record);
  const http = live && (await httpReady(`${record.url}/`));
  let plugins: unknown = null;
  if (live) {
    const result = runPaseo(record.paseoBin, record.home, ["plugin", "ls", "--json"], { timeoutMs: 30_000 });
    if (result.status === 0) {
      try {
        plugins = JSON.parse(result.stdout);
      } catch {
        plugins = result.stdout.trim();
      }
    }
  }
  return { record, live, http, plugins };
}

/** The record for commands that need a running dev daemon. */
export function requireDaemon(name = "default"): DaemonRecord {
  const record = readDaemon(name);
  if (!record || !isDaemonLive(record)) {
    throw new Error(`no running dev daemon "${name}": run \`ppd daemon up\` first`);
  }
  assertSafeHome(record.home);
  assertSafePort(record.port);
  return record;
}

export function daemonLogTail(record: DaemonRecord, lines = 40): string {
  return run("tail", ["-n", String(lines), join(record.home, "daemon.log")]).stdout;
}

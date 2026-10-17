// Guards that keep ppd away from the user's real Paseo daemon. Every daemon, install and web command
// goes through these checks; they are pure so the tests can pin them.
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** The port of the user's real Paseo daemon. ppd never binds, probes for install, or targets it. */
export const REAL_DAEMON_PORT = 6767;
/** Ports ppd picks from when --port is not given. */
export const DEFAULT_PORT_RANGE = { first: 7800, last: 7899 } as const;
/** Marker written into every home ppd creates. Homes without it are never deleted. */
export const HOME_MARKER = ".ppd-home";

export class SafetyError extends Error {
  override name = "SafetyError";
}

export function assertSafePort(port: number): number {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new SafetyError(`port must be an integer between 1024 and 65535, got ${port}`);
  }
  if (port === REAL_DAEMON_PORT) {
    throw new SafetyError(`refusing port ${REAL_DAEMON_PORT}: it belongs to your real Paseo daemon`);
  }
  return port;
}

export function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new SafetyError(`not a port: ${value}`);
  return assertSafePort(Number(value));
}

/** Resolves symlinks of the longest existing prefix, so /var and /private/var compare equal on macOS. */
export function canonicalPath(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    rest.unshift(current.slice(parent.length).replace(/^[\\/]/, ""));
    current = parent;
  }
  const base = existsSync(current) ? realpathSync.native(current) : current;
  return rest.length ? resolve(base, ...rest) : base;
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface HomeContext {
  userHome: string;
  tempRoots: string[];
}

export function defaultHomeContext(): HomeContext {
  const roots = new Set([tmpdir(), "/tmp", "/private/tmp"].filter(existsSync).map(canonicalPath));
  return { userHome: homedir(), tempRoots: [...roots] };
}

/** The real Paseo home in both spellings, plus PASEO_HOME when the shell points somewhere else. */
export function realPaseoHomes(context: HomeContext, env: NodeJS.ProcessEnv = process.env): string[] {
  const homes = [resolve(context.userHome, ".paseo")];
  if (env.PASEO_HOME && !isTempish(env.PASEO_HOME, context)) homes.push(resolve(env.PASEO_HOME));
  return [...new Set(homes.flatMap((home) => [home, canonicalPath(home)]))];
}

function isTempish(path: string, context: HomeContext): boolean {
  const canonical = canonicalPath(path);
  return context.tempRoots.some((root) => canonical !== root && isInside(canonical, root));
}

/**
 * A dev daemon home must be a strict subdirectory of a temp root and never the real Paseo home.
 * Returns the canonical path.
 */
export function assertSafeHome(home: string, context: HomeContext = defaultHomeContext(), env: NodeJS.ProcessEnv = process.env): string {
  const canonical = canonicalPath(home);
  for (const real of realPaseoHomes(context, env)) {
    if (isInside(canonical, real) || isInside(real, canonical)) {
      throw new SafetyError(`refusing home ${home}: it overlaps your real Paseo home ${real}`);
    }
  }
  if (canonical === canonicalPath(context.userHome) || canonical === sep) {
    throw new SafetyError(`refusing home ${home}: not a scratch directory`);
  }
  if (!isTempish(canonical, context)) {
    throw new SafetyError(`refusing home ${home}: dev daemon homes must live under a temp directory (${context.tempRoots.join(", ")})`);
  }
  return canonical;
}

/** True when a `ps` command line belongs to a daemon started with exactly this home. */
export function commandUsesHome(command: string, home: string): boolean {
  const tokens = command.trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "--home" && tokens[index + 1] === home) return true;
    if (token === `--home=${home}`) return true;
  }
  return false;
}

/**
 * Arguments for the Paseo CLI aimed at a dev daemon. The home flag is always appended, and caller flags
 * that could retarget the CLI are rejected, so a typo cannot reach the real daemon.
 */
export function paseoArgsForHome(args: readonly string[], home: string): string[] {
  for (const arg of args) {
    if (arg === "--home" || arg.startsWith("--home=") || arg === "--host" || arg.startsWith("--host=")) {
      throw new SafetyError(`do not pass ${arg.split("=")[0]}: ppd always targets its own dev daemon`);
    }
  }
  return [...args, "--home", home];
}

/** Environment for any child process that talks to a dev daemon. */
export function devDaemonEnv(base: NodeJS.ProcessEnv, home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PASEO_HOME: home, ...extra };
  delete env.PASEO_HOST;
  return env;
}

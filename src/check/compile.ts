// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e:
//   packages/server/src/server/plugins/compiler.ts (wrapCommonJsBundle, makeHermesInteropEager, compileTarget build options)
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.
// Modified: the build runs on the devkit's own esbuild without Paseo's import-boundary plugin, metafile dependency
// check or type walk, and esbuild errors are reported with file:line:column.
//
// Compiling a plugin the way Paseo does. The host is, in order: a Paseo source checkout (PASEO_SOURCE), the
// installed Paseo app (its app.asar ships the server's manifest reader, compilePlugin and bundle evaluator), or,
// as a last resort, an esbuild approximation of the same build options that misses Paseo's import-boundary and
// type-walk checks.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { CLIENT_HOST_MODULES, SDK_SPECIFIERS, SERVER_HOST_MODULES } from "./host.ts";
import { describeNoResult, runChild } from "./isolate.ts";
import { which } from "../proc.ts";

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
  "no Paseo app or PASEO_SOURCE found: install Paseo, or set PASEO_APP to Paseo.app or PASEO_SOURCE to a getpaseo/paseo checkout with node_modules";

/** An installed Paseo desktop app whose bundled server modules can compile plugins (macOS). */
export interface PaseoApp {
  app: string;
  resources: string;
  /** The Electron helper; with ELECTRON_RUN_AS_NODE=1 it is a Node that reads app.asar. */
  helper: string;
  version: string | null;
}

const APP_PLUGINS = "app.asar/node_modules/@getpaseo/server/dist/server/server/plugins";

export function paseoAppAt(app: string): PaseoApp | null {
  const resources = join(app, "Contents/Resources");
  const helper = join(app, "Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper");
  if (!existsSync(join(resources, "app.asar")) || !existsSync(helper)) return null;
  const plist = existsSync(join(app, "Contents/Info.plist")) ? readFileSync(join(app, "Contents/Info.plist"), "utf8") : "";
  const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null;
  return { app: resolve(app), resources, helper, version };
}

/** The `paseo` on PATH, when it is the launcher inside an app bundle (…/Paseo.app/Contents/Resources/bin/paseo). */
function appFromPath(env: NodeJS.ProcessEnv): string | null {
  const bin = which("paseo", env);
  if (!bin) return null;
  try {
    return /^(.*\.app)\/Contents\/Resources\/bin\/paseo$/.exec(realpathSync(bin))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** PASEO_APP, the app behind `paseo` on PATH, then /Applications and ~/Applications. An explicit path must be valid. */
export function findPaseoApp(explicit?: string, env: NodeJS.ProcessEnv = process.env): PaseoApp | null {
  const wanted = explicit ?? env.PASEO_APP;
  if (wanted) return paseoAppAt(wanted);
  for (const candidate of [appFromPath(env), "/Applications/Paseo.app", join(homedir(), "Applications/Paseo.app")]) {
    const app = candidate ? paseoAppAt(candidate) : null;
    if (app) return app;
  }
  return null;
}

/** Where the real compiler comes from. Null means the esbuild approximation. */
export type PaseoHost = { kind: "source"; root: string } | ({ kind: "app" } & PaseoApp);

export interface HostSelection {
  /** A checkout path, null to skip, undefined for PASEO_SOURCE. */
  paseoSource?: string | null;
  /** A Paseo.app path, null to skip, undefined to discover. */
  paseoApp?: string | null;
}

export function findPaseoHost(selection: HostSelection = {}, env: NodeJS.ProcessEnv = process.env): PaseoHost | null {
  const root = selection.paseoSource === undefined ? findPaseoSource(undefined, env) : selection.paseoSource;
  if (root) return { kind: "source", root };
  if (selection.paseoApp === null) return null;
  const app = selection.paseoApp === undefined ? findPaseoApp(undefined, env) : paseoAppAt(selection.paseoApp);
  return app ? { kind: "app", ...app } : null;
}

export function describeHost(host: PaseoHost): string {
  return host.kind === "app" ? `Paseo ${host.version ?? "?"} app (${host.app})` : `Paseo source checkout (${host.root})`;
}

function wrapCommonJs(code: string): string {
  return `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
}

/** esbuild with the options of Paseo 0.11's compileTarget. Returns the wrapped `(function(require) {...})` bundle. */
export async function compileLikePaseo(entry: string, target: Target): Promise<string> {
  return (await compileApprox(entry, target)).bundle;
}

/** Thrown for esbuild errors, one `file:line:column: text` line per error, paths relative to the plugin. */
export class CompileError extends Error {
  override name = "CompileError";
  readonly locations: string[];
  constructor(locations: string[]) {
    super(locations[0] ?? "compile failed");
    this.locations = locations;
  }
}

export interface ApproxCompile {
  bundle: string;
}

/** compileLikePaseo with esbuild errors as a CompileError. The entry sits at the plugin root. */
export async function compileApprox(entry: string, target: Target): Promise<ApproxCompile> {
  let result;
  try {
    result = await build({
      entryPoints: [entry],
      absWorkingDir: dirname(resolve(entry)),
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
  } catch (error) {
    const messages = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
    if (!messages?.length) throw error;
    throw new CompileError(messages.map((m) => (m.location ? `${m.location.file}:${m.location.line}:${m.location.column + 1}: ${m.text}` : m.text)));
  }
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error(`${target} compilation produced no output`);
  return { bundle: wrapCommonJs(output.replaceAll("get: () => from[key]", "value: from[key]")) };
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
  /** The server cleanup threw. */
  cleanupError: string | null;
  /** Handles the server contribution left open after its cleanup ran. */
  leaks: string[];
}

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/host-compile.mjs");

interface ScriptResult {
  stage: "load" | "manifest" | "compiled" | "compile" | "evaluate" | "done";
  error?: string;
  handlers: string[];
  registrations: string[];
  evalMs: number | null;
  returnsCleanup: boolean | null;
  cleanupError?: string | null;
  leaks?: string[];
}

/**
 * Runs scripts/host-compile.mjs in a child with a timeout, so Paseo's own modules do the work and plugin code
 * (the server contribution) cannot hang or exit ppd. With a Paseo checkout the runtime is its tsx.
 */
export async function compileWithPaseo(pluginDir: string, paseoSource: string, timeoutMs = DEFAULT_COMPILE_TIMEOUT_MS): Promise<PaseoCompileResult> {
  return compileWithHost(pluginDir, { kind: "source", root: paseoSource }, timeoutMs);
}

/** The host's own compile and server evaluation, in a child process (tsx for a checkout, the app's Electron Node for the app). */
export async function compileWithHost(pluginDir: string, host: PaseoHost, timeoutMs = DEFAULT_COMPILE_TIMEOUT_MS): Promise<PaseoCompileResult> {
  if (host.kind === "source") {
    const plugins = join(host.root, "packages/server/src/server/plugins");
    return runHostCompile(join(host.root, "node_modules/.bin/tsx"), [SCRIPT, plugins, ".ts", resolve(pluginDir)], { cwd: host.root, timeoutMs });
  }
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  return runHostCompile(host.helper, [SCRIPT, join(host.resources, APP_PLUGINS), ".js", resolve(pluginDir)], { env, timeoutMs });
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
    const base = { clientBundle: read("client.js"), serverBundle: read("server.js"), handlers: result.handlers, registrations: result.registrations, evalMs: result.evalMs, returnsCleanup: result.returnsCleanup, cleanupError: result.cleanupError ?? null, leaks: result.leaks ?? [] };
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

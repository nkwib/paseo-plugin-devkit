// Hermes checks for client bundles. iOS and Android evaluate plugin client bundles from source on Hermes,
// so syntax that works in a browser can crash only on phones (getpaseo/paseo#5783: class syntax).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";
import { CLIENT_HOST_MODULES } from "./host.ts";

const PLATFORM_DIR: Record<string, string> = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" };

export interface HermesTools {
  hermesc: string | null;
  hermes: string | null;
}

/** HERMESC/HERMES env, then react-native's bundled binaries in the plugin, then in PASEO_SOURCE. */
export function findHermes(pluginDir: string, env: NodeJS.ProcessEnv = process.env): HermesTools {
  const platform = PLATFORM_DIR[process.platform] ?? "none";
  const roots = [pluginDir, env.PASEO_SOURCE, env.PASEO_SOURCE && join(env.PASEO_SOURCE, "packages/app")]
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, "node_modules/react-native/sdks/hermesc", platform));
  const find = (name: string, override?: string) =>
    [override, ...roots.flatMap((dir) => [join(dir, name), join(dir, `${name}.exe`)])].find(
      (path): path is string => Boolean(path) && existsSync(path!),
    ) ?? null;
  return { hermesc: find("hermesc", env.HERMESC), hermes: find("hermes", env.HERMES) };
}

/** Class syntax left in the bundle. Empty means none. */
export async function classSyntaxErrors(code: string): Promise<string[]> {
  try {
    await transform(code, { loader: "js", supported: { class: false }, logLevel: "silent" });
    return [];
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { line?: number; lineText?: string } | null }[] }).errors ?? [];
    return errors.map((entry) => `${entry.text} (line ${entry.location?.line ?? "?"}): ${entry.location?.lineText?.trim().slice(0, 120) ?? ""}`);
  }
}

export interface HermesRun {
  ok: boolean;
  output: string;
}

function withTempFile<T>(name: string, contents: string, use: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ppd-hermes-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, contents);
    return use(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function hermesParse(hermesc: string, bundle: string): HermesRun {
  return withTempFile("bundle.js", bundle, (file) => {
    const result = spawnSync(hermesc, ["-emit-binary", "-out", `${file}.hbc`, file], { encoding: "utf8", timeout: 120_000 });
    return { ok: result.status === 0 && !result.stderr.trim(), output: (result.stderr || result.stdout).trim() };
  });
}

/**
 * A Hermes program that evaluates the bundle with stub host modules and runs the contribution against a
 * recording client. Prints one JSON line: { registered, icons } or { error, stage }.
 */
export function hermesSmokeProgram(bundle: string): string {
  return `
var log = typeof print === "function" ? print : function () {};
function stub(thenable) {
  return new Proxy(function () {}, {
    get: function (_, key) {
      if (key === "then") {
        if (!thenable) return undefined;
        return function (resolve) { var value = stub(false); return Promise.resolve(resolve ? resolve(value) : value); };
      }
      if (key === "__esModule") return true;
      if (typeof key === "string" && /^define[A-Z]/.test(key)) return function (value) { return value; };
      if (key === "OS") return "ios";
      if (key === "length") return 0;
      if (key === Symbol.iterator) return function () { return { next: function () { return { done: true }; } }; };
      return stub(true);
    },
    apply: function () { return stub(true); },
    construct: function () { return stub(true); }
  });
}
var chain = stub(true);
var hostModules = ${JSON.stringify(CLIENT_HOST_MODULES)};
function hostRequire(name) {
  if (hostModules.indexOf(name) === -1) throw new Error('Module "' + name + '" is not available in plugin client code');
  return chain;
}
var registered = [];
var icons = [];
function collectIcons(value, depth) {
  if (!value || typeof value !== "object" || depth > 2) return;
  Object.keys(value).forEach(function (key) {
    var child = value[key];
    if (key === "icon" && typeof child === "string") icons.push(child);
    else if (child && typeof child === "object") collectIcons(child, depth + 1);
  });
}
var client = new Proxy({}, {
  get: function (_, key) {
    if (typeof key === "string" && /^add[A-Z]/.test(key)) {
      return function (contribution) { registered.push(key); collectIcons(contribution, 0); return chain; };
    }
    return chain;
  }
});
var setup;
try {
  var evaluate = globalThis.eval;
  setup = evaluate(${JSON.stringify(bundle)})(hostRequire)["default"];
} catch (error) {
  log(JSON.stringify({ stage: "evaluate", error: String(error && error.stack || error) }));
  throw error;
}
try {
  setup(client);
  log(JSON.stringify({ registered: registered, icons: icons }));
} catch (error) {
  log(JSON.stringify({ stage: "contribute", error: String(error), registered: registered, icons: icons }));
}
`;
}

export interface HermesSmoke {
  ok: boolean;
  stage?: "evaluate" | "contribute" | "crash";
  error?: string;
  registered: string[];
  icons: string[];
}

export function hermesSmoke(hermes: string, bundle: string): HermesSmoke {
  return withTempFile("smoke.js", hermesSmokeProgram(bundle), (file) => {
    const result = spawnSync(hermes, [file], { encoding: "utf8", timeout: 120_000 });
    const line = result.stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) return { ok: false, stage: "crash", error: (result.stderr || `exit ${result.status}`).trim().slice(0, 2000), registered: [], icons: [] };
    const parsed = JSON.parse(line) as Partial<HermesSmoke>;
    return {
      ok: !parsed.error,
      ...(parsed.stage ? { stage: parsed.stage } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
      registered: parsed.registered ?? [],
      icons: parsed.icons ?? [],
    };
  });
}

// Compiling a plugin the way Paseo does. With a Paseo source checkout (PASEO_SOURCE) this runs Paseo's own
// manifest reader, compilePlugin and server bundle evaluator. Without one it uses an esbuild approximation
// of the same build options, which misses Paseo's import-boundary and type-walk checks.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { CLIENT_HOST_MODULES, SDK_SPECIFIERS, SERVER_HOST_MODULES } from "./host.ts";

const execFileAsync = promisify(execFile);

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
  stage?: "manifest" | "compile" | "evaluate";
  clientBundle: string | null;
  serverBundle: string | null;
  handlers: string[];
  registrations: string[];
  evalMs: number | null;
}

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/paseo-compile.mts");

/** Runs scripts/paseo-compile.mts with the checkout's tsx, so Paseo's own modules do the work. */
export async function compileWithPaseo(pluginDir: string, paseoSource: string): Promise<PaseoCompileResult> {
  const out = mkdtempSync(join(tmpdir(), "ppd-compile-"));
  try {
    await execFileAsync(join(paseoSource, "node_modules/.bin/tsx"), [SCRIPT, paseoSource, resolve(pluginDir), out], {
      cwd: paseoSource,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
    });
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8")) as Omit<PaseoCompileResult, "clientBundle" | "serverBundle">;
    const read = (name: string) => (existsSync(join(out, name)) ? readFileSync(join(out, name), "utf8") : null);
    return { ...result, clientBundle: read("client.js"), serverBundle: read("server.js") };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

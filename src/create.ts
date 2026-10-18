// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e:
//   packages/cli/src/commands/plugin/scaffold.ts (the layout writeBuiltinBase reproduces)
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.
// Modified: only the manifest, OVERVIEW.md stub, package.json and tsconfig are reproduced, the OVERVIEW.md guidance
// is shortened, and the SDK version comes from the local Paseo CLI.
//
// `ppd create`: a new plugin that passes `ppd check` and installs as is. The base comes from `paseo plugin init`
// when the Paseo CLI has it (manifest, OVERVIEW.md guidance, SDK versions matching the host), else from a built-in
// copy of the same layout. A template then replaces init's sample code, and the files init leaves out are added:
// tsconfig node types, an @types/node pin, .gitignore, vitest, `npm run check`, a README.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPaseoBin, paseoVersion } from "./paseo.ts";
import { run } from "./proc.ts";
import { devDaemonEnv } from "./safety.ts";
import { UsageError } from "./usage.ts";

export const TEMPLATES = ["panel", "agent-hook"] as const;
export type Template = (typeof TEMPLATES)[number];

/** Where `npm install` gets the devkit from. It is not on npm; pass --devkit for a local clone (`file:...`). */
export const DEFAULT_DEVKIT_SPEC = "github:nkwib/paseo-plugin-devkit";
/** SDK version for the built-in base when there is no Paseo CLI to ask. */
export const FALLBACK_PASEO_VERSION = "0.11.4";
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(ROOT, "templates");
const HELLO_PLUGIN = join(ROOT, "examples/hello-plugin");

export interface CreateOptions {
  template?: Template;
  id?: string;
  /** Display name for the manifest and README (default: from the id). */
  name?: string;
  /** package.json spec for paseo-plugin-devkit. */
  devkit?: string;
  /** Paseo CLI to run `plugin init` with; null skips init and uses the built-in base. */
  paseo?: string | null;
  log?: (line: string) => void;
}

export interface CreateResult {
  dir: string;
  id: string;
  template: Template;
  base: "paseo plugin init" | "built-in";
  /** Why init was not used, when base is built-in. */
  baseNote: string | null;
  files: string[];
}

export function isTemplate(value: string): value is Template {
  return (TEMPLATES as readonly string[]).includes(value);
}

export function displayName(id: string): string {
  const words = id.split("-").filter(Boolean);
  return words.map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word)).join(" ");
}

/** The devkit's own pins, so a created plugin tests with the versions the devkit is tested with. */
function devkitDevDependency(name: string): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
  const version = pkg.devDependencies?.[name];
  if (!version) throw new Error(`devkit package.json has no devDependency ${name}`);
  return version;
}

const TEMPLATE_INFO: Record<Template, { description: string; extraDependencies: (sdk: string) => Record<string, string> }> = {
  panel: {
    description: "A workspace panel that calls one server RPC.",
    extraDependencies: () => ({}),
  },
  "agent-hook": {
    description: "Appends a summary card to the agent timeline when a turn that used tools ends.",
    // Peer dependencies of the SDK that type hook events and PaseoApi; pinned so installers that skip peers (yarn v1, --legacy-peer-deps) still get them.
    extraDependencies: (sdk) => ({ "@getpaseo/client": sdk, "@getpaseo/protocol": sdk }),
  },
};

export async function createPlugin(target: string, options: CreateOptions = {}): Promise<CreateResult> {
  const log = options.log ?? (() => {});
  const dir = resolve(target);
  const template = options.template ?? "panel";
  const id = options.id ?? basename(dir);
  if (!PLUGIN_ID.test(id)) {
    throw new UsageError(`invalid plugin id "${id}": lowercase letters, digits and dashes, starting with a letter (pass --id)`);
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new UsageError(`${dir} is not empty`);
  const name = options.name ?? displayName(id);

  const init = options.paseo === null ? { ok: false as const, note: "skipped (--no-init)" } : runInit(dir, id, options.paseo);
  let baseNote: string | null = null;
  if (init.ok) {
    log(`base: paseo plugin init (Paseo ${init.version ?? "?"})`);
  } else {
    baseNote = init.note;
    log(`base: built-in (${init.note})`);
    writeBuiltinBase(dir, id, init.version ?? FALLBACK_PASEO_VERSION);
  }

  // Init's sample code is replaced by the template. The directory was empty, so these are all init's.
  for (const entry of ["index.client.ts", "index.client.tsx", "index.server.ts", "index.server.tsx", "client", "server", "shared"]) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
  writeTemplate(dir, template);
  copyTree(join(TEMPLATE_DIR, "common"), dir);
  renameSync(join(dir, "gitignore"), join(dir, ".gitignore"));

  const tokens = { "{{id}}": id, "{{name}}": name };
  for (const file of ["README.md"]) replaceTokens(join(dir, file), tokens);

  patchManifest(dir, name, TEMPLATE_INFO[template].description);
  patchPackageJson(dir, template, options.devkit ?? DEFAULT_DEVKIT_SPEC, TEMPLATE_INFO[template].description);
  patchTsconfig(dir);

  return { dir, id, template, base: init.ok ? "paseo plugin init" : "built-in", baseNote, files: listFiles(dir) };
}

type InitResult = { ok: true; version: string | null } | { ok: false; note: string; version?: string | null };

function runInit(dir: string, id: string, explicit: string | undefined): InitResult {
  const bin = findPaseoBin(explicit);
  if (!bin) {
    if (explicit) throw new Error(`Paseo CLI ${explicit} does not exist`);
    return { ok: false, note: "no Paseo CLI found" };
  }
  const version = paseoVersion(bin);
  mkdirSync(dirname(dir), { recursive: true });
  // cwd and PASEO_HOME are temp paths: init takes an absolute path and needs no daemon, so nothing may
  // resolve to ~/.paseo. Init does not create the home.
  const result = run(bin, ["plugin", "init", dir, "--id", id, "--json"], {
    cwd: tmpdir(),
    env: devDaemonEnv(process.env, join(tmpdir(), "ppd-create-unused-home")),
    timeout: 120_000,
  });
  if (result.status === 0 && existsSync(join(dir, "paseo-plugin.json"))) return { ok: true, version };
  rmSync(dir, { recursive: true, force: true });
  const reason = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
  return { ok: false, note: `paseo plugin init failed${reason ? `: ${reason}` : ""}`, version };
}

/** The same layout `paseo plugin init` writes (getpaseo/paseo packages/cli/src/commands/plugin/scaffold.ts). */
function writeBuiltinBase(dir: string, id: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "paseo-plugin.json"), {
    id,
    $comment:
      'Add "icon": "assets/icon.png" for a PNG inside the package. Add image or video paths (relative to this manifest) or HTTPS URLs to media. Include local assets in package.json files.',
    media: [],
    requirements: { paseo: `>=${version}` },
  });
  writeFileSync(
    join(dir, "OVERVIEW.md"),
    "<!--\nOVERVIEW.md is required to list your plugin in the registry. Describe what the plugin does in plain terms,\nthen setup, capabilities and limits. No install commands, badges or changelog. Replace this comment.\n-->\n",
  );
  writeJson(join(dir, "package.json"), {
    name: id,
    private: true,
    version: "0.0.0",
    files: ["paseo-plugin.json", "OVERVIEW.md", "index.client.ts", "index.client.tsx", "index.server.ts", "index.server.tsx", "client/", "server/", "shared/"],
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: {
      "@getpaseo/plugin": version,
      "@tanstack/react-query": "^5.90.11",
      "@types/react": "~19.2.0",
      react: "19.1.0",
      "react-native": "0.81.5",
      typescript: "^5.9.3",
      zod: "^4.4.3",
    },
  });
  writeJson(join(dir, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2023"],
      types: ["react"],
      jsx: "react-jsx",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    include: ["**/*.ts", "**/*.tsx"],
  });
}

function writeTemplate(dir: string, template: Template): void {
  if (template === "panel") {
    // The panel template is the devkit's hello-plugin: a workspace panel, a Command Center item and one RPC.
    for (const entry of ["index.client.tsx", "index.server.ts", "client", "server", "shared"]) {
      cpSync(join(HELLO_PLUGIN, entry), join(dir, entry), { recursive: true });
    }
  }
  copyTree(join(TEMPLATE_DIR, template), dir);
}

function patchManifest(dir: string, name: string, description: string): void {
  const path = join(dir, "paseo-plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const { id, ...rest } = manifest;
  writeJson(path, { id, name, description, ...rest });
}

export function scriptsFor(): Record<string, string> {
  return {
    typecheck: "tsc --noEmit",
    test: "vitest run",
    check: "ppd check",
    dev: "ppd dev",
  };
}

function patchPackageJson(dir: string, template: Template, devkit: string, description: string): void {
  const path = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
  };
  const deps = pkg.devDependencies ?? {};
  const sdk = deps["@getpaseo/plugin"] ?? FALLBACK_PASEO_VERSION;
  pkg.description = description;
  pkg.type = "module";
  pkg.scripts = { ...pkg.scripts, ...scriptsFor() };
  pkg.devDependencies = sortKeys({
    ...deps,
    ...TEMPLATE_INFO[template].extraDependencies(sdk),
    // Paseo <= 0.11.4 type-walks installed packages and @types/node 26 broke installs (getpaseo/paseo#7145).
    "@types/node": devkitDevDependency("@types/node"),
    "paseo-plugin-devkit": devkit,
    vitest: devkitDevDependency("vitest"),
  });
  writeJson(path, pkg);
}

function patchTsconfig(dir: string): void {
  const path = join(dir, "tsconfig.json");
  const tsconfig = JSON.parse(readFileSync(path, "utf8")) as { compilerOptions?: { types?: string[] }; exclude?: string[] };
  const options = (tsconfig.compilerOptions ??= {});
  options.types = [...new Set([...(options.types ?? []), "node"])];
  tsconfig.exclude = [...new Set([...(tsconfig.exclude ?? []), "node_modules", "dist"])];
  writeJson(path, tsconfig);
}

function copyTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true, force: true });
}

function replaceTokens(path: string, tokens: Record<string, string>): void {
  let text = readFileSync(path, "utf8");
  for (const [token, value] of Object.entries(tokens)) text = text.split(token).join(value);
  writeFileSync(path, text);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function listFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** `ppd create` output. */
export function formatCreate(result: CreateResult): string {
  const shown = relative(process.cwd(), result.dir);
  const where = shown && !shown.startsWith("..") ? shown : result.dir;
  return [
    `created ${result.id} (${result.template} template) in ${where}`,
    `  base: ${result.base}${result.baseNote ? ` (${result.baseNote})` : ""}`,
    ...result.files.map((file) => `  ${file}`),
    "",
    "next:",
    `  cd ${where} && npm install`,
    "  npm run check && npm test",
    `  npx ppd daemon up${result.template === "agent-hook" ? " --fake-agent" : ""} && npx ppd dev`,
  ].join("\n");
}

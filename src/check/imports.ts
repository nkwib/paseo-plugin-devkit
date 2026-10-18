// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e:
//   packages/server/src/server/plugins/compiler.ts (directoryTarget)
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.
// Modified: moduleLocation takes a path relative to the plugin and accepts both path separators.
//
// Source-level import scan: directory boundaries, forbidden client packages and runtime dependency placement.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { CLIENT_FORBIDDEN_PACKAGES, isHostProvidedPackage, isNodeBuiltin, packageName } from "./host.ts";

const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

export function codeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return codeFiles(full);
    return CODE.has(extname(name)) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

export function importSpecifiers(source: string): string[] {
  const found = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
  ];
  return [...new Set(found.map((match) => match[1]!))];
}

export type Runtime = "client" | "server" | "shared";

export interface PluginFiles {
  client: string[];
  server: string[];
  shared: string[];
}

export function pluginFiles(pluginDir: string): PluginFiles {
  const root = (names: string[]) => names.map((name) => join(pluginDir, name)).filter(existsSync);
  return {
    client: [...root(["index.client.tsx", "index.client.ts"]), ...codeFiles(join(pluginDir, "client"))],
    server: [...root(["index.server.ts", "index.server.tsx"]), ...codeFiles(join(pluginDir, "server"))],
    shared: codeFiles(join(pluginDir, "shared")),
  };
}

/** Where a module may live, like Paseo's compiler.ts directoryTarget. Null for node_modules. */
export function moduleLocation(relativePath: string): Runtime | "invalid" | null {
  const segments = relativePath.split(/[\\/]/);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return "invalid";
  if (segments.includes("node_modules")) return null;
  if (segments[0] === "client" || segments[0] === "server" || segments[0] === "shared") return segments[0];
  if (/^index\.client\.tsx?$/.test(relativePath)) return "client";
  if (/^index\.server\.tsx?$/.test(relativePath)) return "server";
  return "invalid";
}

export interface Finding {
  level: "error" | "warn";
  message: string;
}

/** Boundary rules from Paseo's plugin docs: client has no Node, server has no React, shared has neither. */
export function boundaryFindings(pluginDir: string, files: PluginFiles): Finding[] {
  const findings: Finding[] = [];
  const check = (runtime: Runtime, file: string) => {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      const where = `${relative(pluginDir, file)} imports ${specifier}`;
      if (runtime !== "server" && isNodeBuiltin(specifier)) findings.push({ level: "error", message: `${where}: Node modules are server-only` });
      if (runtime !== "client" && /^(react|react-native|react-dom)(\/|$)/.test(specifier)) findings.push({ level: "error", message: `${where}: React is client-only` });
      if (runtime === "client" && /(^|\/)server(\/|$)/.test(specifier) && specifier.startsWith(".")) findings.push({ level: "error", message: `${where}: client code cannot import server/` });
      if (runtime === "server" && /(^|\/)client(\/|$)/.test(specifier) && specifier.startsWith(".")) findings.push({ level: "error", message: `${where}: server code cannot import client/` });
      if (runtime === "shared" && /(^|\/)(server|client)(\/|$)/.test(specifier) && specifier.startsWith(".")) findings.push({ level: "error", message: `${where}: shared/ imports neither runtime` });
      if (runtime !== "server") {
        const reason = CLIENT_FORBIDDEN_PACKAGES[specifier] ?? CLIENT_FORBIDDEN_PACKAGES[packageName(specifier)];
        if (reason) findings.push({ level: "error", message: `${where}: ${reason}` });
      }
    }
  };
  for (const runtime of ["client", "server", "shared"] as const) for (const file of files[runtime]) check(runtime, file);
  // Paseo's compiler (directoryTarget) rejects any plugin module outside client/, server/ and shared/, even an unused import.
  for (const file of [...files.client, ...files.server, ...files.shared]) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = relative(pluginDir, resolve(dirname(file), specifier));
      if (moduleLocation(target) === "invalid") {
        findings.push({ level: "error", message: `${relative(pluginDir, file)} imports ${specifier}: plugin modules belong in client/, server/ or shared/ (Paseo's compiler rejects ${target})` });
      }
    }
  }
  return findings;
}

export function externalPackages(files: string[]): Set<string> {
  return new Set(
    files
      .flatMap((file) => importSpecifiers(readFileSync(file, "utf8")))
      .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("/") && !isNodeBuiltin(specifier))
      .map(packageName)
      .filter((name) => !isHostProvidedPackage(name) && !name.startsWith("@getpaseo/")),
  );
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Git and registry installs compile from a fresh checkout. Packages the plugin imports must be installed by the
 * manifest build (runtime `dependencies` with `npm ci --omit=dev`), or the compile fails on the user's machine.
 */
export function dependencyFindings(imported: Set<string>, pkg: PackageJson, build: string[][] | undefined): Finding[] {
  const findings: Finding[] = [];
  const omitsDev = (build ?? []).some((argv) => argv.includes("--omit=dev") || argv.includes("--production"));
  for (const name of imported) {
    const runtime = pkg.dependencies?.[name];
    const dev = pkg.devDependencies?.[name];
    if (!runtime && !dev) findings.push({ level: "error", message: `${name} is imported but not declared in package.json` });
    else if (!runtime && omitsDev) findings.push({ level: "error", message: `${name} is imported but only in devDependencies; the manifest build omits dev dependencies` });
  }
  if (imported.size && !build?.length) {
    findings.push({
      level: "warn",
      message: `imports ${[...imported].join(", ")} but paseo-plugin.json has no build step; Git installs need ["npm", "ci", "--omit=dev", "--ignore-scripts"]`,
    });
  }
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (isHostProvidedPackage(name) || name.startsWith("@getpaseo/")) {
      findings.push({ level: "warn", message: `${name} is host-provided: move it to devDependencies` });
    }
  }
  return findings;
}

/** Paseo <= 0.11.4 type-walks installed @types/node; v26 pulled in node:stream/iter and failed installs (getpaseo/paseo#7145). */
export function typesNodeFinding(pkg: PackageJson): Finding | null {
  const range = pkg.dependencies?.["@types/node"];
  if (!range) return null;
  const major = Number(/(\d+)/.exec(range)?.[1] ?? 0);
  return major >= 26 || range === "*" || range === "latest"
    ? { level: "warn", message: `@types/node ${range} in dependencies: pin ~22 (install-time type walk, getpaseo/paseo#7145)` }
    : null;
}

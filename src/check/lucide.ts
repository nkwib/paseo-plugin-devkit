// Lucide icon names. Paseo validates contribution `icon` names at runtime and an unknown name throws,
// which shows up as a silently missing sidebar or Command Center item.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { layoutMismatch } from "../compat.ts";
import { describeHost, type PaseoHost } from "./compile.ts";

/** Exports the app refuses as icons even though lucide-react-native has them (packages/app/src/plugins/icons.ts). */
const NOT_ICONS = new Set(["Icon", "createLucideIcon"]);

const TYPES = "lucide-react-native/dist/types/lucide-react-native.d.ts";

export function lucideTypesFile(roots: (string | null | undefined)[]): string | null {
  for (const root of roots) {
    if (!root) continue;
    for (const candidate of [join(root, "packages/app/node_modules", TYPES), join(root, "node_modules", TYPES)]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Exported icon names (including aliases) from lucide-react-native's type declarations. */
export function parseLucideNames(declarations: string): Set<string> {
  const icons = new Set([...declarations.matchAll(/^declare const (\w+): LucideIcon;$/gm)].map((match) => match[1]!));
  const names = new Set<string>();
  for (const list of declarations.matchAll(/^export \{([^}]*)\};?$/gm)) {
    for (const entry of list[1]!.split(",")) {
      const [local = "", exported = local] = entry.trim().split(/\s+as\s+/);
      if (icons.has(local) && !NOT_ICONS.has(exported)) names.add(exported);
    }
  }
  return names;
}

/** Icon names from lucide-react-native type declarations under the given roots. Null when none is installed. */
export function lucideIconNames(roots: (string | null | undefined)[]): { names: Set<string>; source: string } | null {
  const file = lucideTypesFile(roots);
  return file ? { names: parseLucideNames(readFileSync(file, "utf8")), source: file } : null;
}

/**
 * Icon components exported by the lucide-react-native module inside the app's web bundle: Metro emits each one as
 * `Object.defineProperty(exports, "Name", { enumerable: !0, get: function () { return x.default } })`.
 */
export function parseBundleIconNames(bundle: string): Set<string> {
  const anchor = bundle.indexOf('"AArrowDown",{enumerable');
  if (anchor === -1) return new Set();
  const start = bundle.lastIndexOf("__d(function", anchor);
  const end = bundle.indexOf("__d(function", anchor);
  const module = bundle.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
  const names = new Set<string>();
  for (const match of module.matchAll(/defineProperty\([\w$]+,"([A-Z]\w*)",\{enumerable:!0,get:function\(\)\{return [\w$]+\.default\}\}\)/g)) {
    if (!NOT_ICONS.has(match[1]!)) names.add(match[1]!);
  }
  return names;
}

/** Where the app's web bundle lives, relative to Contents/Resources (Paseo 0.11.4). */
export const APP_WEB_BUNDLES = "app-dist/_expo/static/js/web";

/** The exact icon set of an installed Paseo app, read from its web bundle (app-dist). Null when not found. */
export function appIconNames(resources: string): { names: Set<string>; source: string } | null {
  const dir = join(resources, APP_WEB_BUNDLES);
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter((name) => /^index-.*\.js$/.test(name))) {
    const names = parseBundleIconNames(readFileSync(join(dir, file), "utf8"));
    if (names.size) return { names, source: join(dir, file) };
  }
  return null;
}

/**
 * The icon names the host accepts: the app's own set, the checkout's lucide-react-native, or (approximation)
 * the plugin's own lucide-react-native, which may be a different version from the app's.
 */
export function hostIconNames(host: PaseoHost | null, pluginDir: string): { names: Set<string>; source: string; exact: boolean } | null {
  if (host?.kind === "app") {
    const icons = appIconNames(host.resources);
    if (icons) return { ...icons, exact: true };
  }
  if (host?.kind === "source") {
    const icons = lucideIconNames([host.root]);
    if (icons) return { ...icons, exact: true };
  }
  const own = lucideIconNames([pluginDir]);
  return own ? { ...own, exact: false } : null;
}

/**
 * Why the host's own icon list is not in use although a host was found (hostIconNames tries it first), or null.
 * For the app this usually means its bundle layout changed.
 */
export function iconListProblem(host: PaseoHost | null, list: { exact: boolean } | null): string | null {
  if (!host || list?.exact) return null;
  const instead = list ? "Icons are checked against the plugin's own lucide-react-native instead" : "Icon names are not checked";
  if (host.kind === "source") return `the Paseo checkout ${host.root} has no lucide-react-native type declarations (run npm install there). ${instead}`;
  return layoutMismatch(
    `could not read the Lucide icon list of the ${describeHost(host)}`,
    `lucide-react-native's icon exports in Contents/Resources/${APP_WEB_BUNDLES}/index-*.js`,
    host.version,
    instead,
  );
}

/** String literals passed as `icon` props or fields in client source: `icon: "FileText"`, `icon="FileText"`, `<Icon name="FileText"`. */
export function staticIconNames(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\bicon\s*[:=]\s*\{?\s*["'`]([A-Z][A-Za-z0-9]*)["'`]/g)) found.add(match[1]!);
  for (const match of source.matchAll(/<Icon\b[^>]*?\bname\s*=\s*\{?\s*["'`]([A-Z][A-Za-z0-9]*)["'`]/g)) found.add(match[1]!);
  return [...found];
}

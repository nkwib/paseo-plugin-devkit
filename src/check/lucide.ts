// Lucide icon names. Paseo validates contribution `icon` names at runtime and an unknown name throws,
// which shows up as a silently missing sidebar or Command Center item.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
      if (icons.has(local)) names.add(exported);
    }
  }
  return names;
}

/** Icon names the Paseo app knows, from PASEO_SOURCE or the plugin's own lucide-react-native. Null when unavailable. */
export function lucideIconNames(roots: (string | null | undefined)[]): { names: Set<string>; source: string } | null {
  const file = lucideTypesFile(roots);
  return file ? { names: parseLucideNames(readFileSync(file, "utf8")), source: file } : null;
}

/** String literals passed as `icon` props or fields in client source: `icon: "FileText"`, `icon="FileText"`, `<Icon name="FileText"`. */
export function staticIconNames(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\bicon\s*[:=]\s*\{?\s*["'`]([A-Z][A-Za-z0-9]*)["'`]/g)) found.add(match[1]!);
  for (const match of source.matchAll(/<Icon\b[^>]*?\bname\s*=\s*\{?\s*["'`]([A-Z][A-Za-z0-9]*)["'`]/g)) found.add(match[1]!);
  return [...found];
}

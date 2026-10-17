import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { run } from "./proc.ts";

/** The repository root and the plugin's path inside it ("" at the root), or null outside Git. */
export function gitLocation(dir: string): { root: string; path: string } | null {
  const top = run("git", ["rev-parse", "--show-toplevel"], { cwd: resolve(dir) });
  if (top.status !== 0) return null;
  const root = realpathSync(top.stdout.trim());
  return { root, path: relative(root, realpathSync(resolve(dir))).split(sep).join("/") };
}

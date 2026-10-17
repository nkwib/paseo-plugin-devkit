import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES = join(ROOT, "test/fixtures");
export const CLI = join(ROOT, "src/cli.ts");

export function scratch(prefix = "ppd-test-"): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

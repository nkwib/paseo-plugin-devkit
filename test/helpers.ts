import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES = join(ROOT, "test/fixtures");
/** The example plugin doubles as the passing fixture. */
export const EXAMPLE = join(ROOT, "examples/hello-plugin");
export const CLI = join(ROOT, "src/cli.ts");

const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function scratch(prefix = "ppd-test-"): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  created.push(dir);
  return dir;
}

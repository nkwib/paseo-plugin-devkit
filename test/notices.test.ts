// Apache-2.0 obligations for the code adapted from getpaseo/paseo: the license text ships, every adapted file
// keeps its origin notice, and the compiled output keeps comments.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const notices = read("THIRD_PARTY_NOTICES");
const adapted = [...notices.matchAll(/^ {2}((?:src|assets)\/\S+)$/gm)].map((match) => match[1]!);

describe("third-party notices", () => {
  it("carries the Paseo copyright and the full Apache-2.0 text", () => {
    expect(notices).toContain("Copyright (c) 2025-present Mohamed Boudra");
    expect(notices).toContain("Apache License\n                           Version 2.0, January 2004");
    expect(notices).toContain("END OF TERMS AND CONDITIONS");
  });

  it("lists the adapted files, and each one starts with an origin notice", () => {
    expect(adapted.length).toBeGreaterThanOrEqual(8);
    for (const file of adapted) {
      const head = read(file).split("\n").slice(0, 8).join("\n");
      expect(head, file).toMatch(/^\/\/ Portions adapted from Paseo \(https:\/\/github\.com\/getpaseo\/paseo\) at commit [0-9a-f]{40}:/);
      expect(head, file).toContain("Mohamed Boudra");
      expect(head, file).toContain("Apache License, Version 2.0");
      expect(head, file).toContain("Modified:");
    }
  });

  it("ships in the npm package, and the build keeps the notices in dist", () => {
    const pkg = JSON.parse(read("package.json")) as { files: string[]; license: string };
    expect(pkg.files).toContain("THIRD_PARTY_NOTICES");
    expect(pkg.license).toContain("Apache-2.0");
    const tsconfig = JSON.parse(read("tsconfig.json")) as { compilerOptions: { removeComments?: boolean } };
    expect(tsconfig.compilerOptions.removeComments).not.toBe(true);
  });
});

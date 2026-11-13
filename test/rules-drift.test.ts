import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULES_CONFIRMED_THROUGH, RULES_SOURCES } from "../src/check/client-rules.ts";

// src/check/client-rules.ts is a copy of Paseo's own registration rules. Nothing else notices when upstream
// changes them, so `ppd check` would keep reporting that a plugin passes rules it has never read. The scheduled
// "tests against Paseo main" job sets PASEO_SOURCE, which is where this alarm fires first.
const source = process.env.PASEO_SOURCE;

describe.skipIf(!source)("client rules against the Paseo checkout", () => {
  it(`matches the files they were copied from (confirmed through ${RULES_CONFIRMED_THROUGH})`, () => {
    const moved: string[] = [];
    const missing: string[] = [];
    for (const [relative, digest] of Object.entries(RULES_SOURCES)) {
      const path = join(source!, relative);
      if (!existsSync(path)) {
        missing.push(relative);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (actual !== digest) moved.push(`${relative}\n    recorded ${digest}\n    found    ${actual}`);
    }
    expect(missing, `PASEO_SOURCE=${source} does not hold these files; point it at a Paseo checkout`).toEqual([]);
    expect(
      moved,
      `Paseo changed the rules ppd copies since ${RULES_CONFIRMED_THROUGH}. Read each file, update the rules in ` +
        `src/check/client-rules.ts if they changed, then record the new digest in RULES_SOURCES and set ` +
        `RULES_CONFIRMED_THROUGH to the release you read.`,
    ).toEqual([]);
  });
});

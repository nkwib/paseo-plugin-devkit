// Opt-in end-to-end run against a real Paseo CLI: PPD_E2E=1 npm test.
// Starts an isolated dev daemon, installs the example plugin, checks it runs, tears down.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daemonDown, daemonUp } from "../src/daemon.ts";
import { installPlugin } from "../src/install.ts";
import { findPaseoBin } from "../src/paseo.ts";
import { EXAMPLE, scratch } from "./helpers.ts";

const enabled = process.env.PPD_E2E === "1" && findPaseoBin() !== null;

describe.skipIf(!enabled)("dev daemon end to end (PPD_E2E=1)", () => {
  it("installs the example plugin into an isolated daemon and removes the home afterwards", async () => {
    process.env.PPD_STATE_DIR = scratch("ppd-e2e-state-");
    const name = "e2e";
    const record = await daemonUp({ name, log: () => {} });
    try {
      expect(record.port).not.toBe(6767);
      const result = await installPlugin(EXAMPLE, { name, log: () => {} });
      expect(result, result.logs).toMatchObject({ id: "hello-plugin", status: "running", error: null });
    } finally {
      await daemonDown({ name, log: () => {} });
    }
    expect(existsSync(record.home)).toBe(false);
  }, 300_000);
});

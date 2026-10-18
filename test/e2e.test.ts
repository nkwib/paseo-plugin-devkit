// Opt-in end-to-end run against a real Paseo CLI: PPD_E2E=1 npm test.
// Starts an isolated dev daemon, installs the example plugin, checks it runs, tears down.
import { existsSync } from "node:fs";
import { join } from "node:path";
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
    const port = process.env.PPD_E2E_PORT ? Number(process.env.PPD_E2E_PORT) : undefined;
    const workspace = join(scratch("ppd-e2e-ws-"), "not/there/yet");
    const lines: string[] = [];
    const record = await daemonUp({ name, port, workspace, log: (line) => lines.push(line) });
    try {
      expect(record.port).not.toBe(6767);
      // A missing workspace directory is created, so Paseo accepts the workspace.
      expect(existsSync(workspace)).toBe(true);
      expect(lines).toContain(`workspace created for ${workspace}`);
      const result = await installPlugin(EXAMPLE, { name, log: () => {} });
      expect(result, result.logs).toMatchObject({ id: "hello-plugin", status: "running", error: null });
    } finally {
      await daemonDown({ name, log: () => {} });
    }
    expect(existsSync(record.home)).toBe(false);
  }, 300_000);
});

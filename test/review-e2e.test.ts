// Opt-in (PPD_E2E=1) review findings that need a real Paseo daemon and Chrome. `it.fails` while the bug stands.
// Port: PPD_E2E_PORT (default 7834) so the run stays on one known port.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { daemonDown, daemonUp } from "../src/daemon.ts";
import { installPlugin } from "../src/install.ts";
import { findPaseoBin } from "../src/paseo.ts";
import { PaseoWeb } from "../src/web.ts";
import { EXAMPLE, scratch } from "./helpers.ts";

const enabled = process.env.PPD_E2E === "1" && findPaseoBin() !== null;
const name = "review-e2e";

describe.skipIf(!enabled)("review findings against a dev daemon (PPD_E2E=1)", () => {
  let url = "";
  beforeAll(async () => {
    process.env.PPD_STATE_DIR = scratch("ppd-review-e2e-state-");
    url = (await daemonUp({ name, port: Number(process.env.PPD_E2E_PORT ?? 7834), log: () => {} })).url;
  }, 120_000);
  afterAll(() => daemonDown({ name, log: () => {} }));

  it("installs the same directory twice (the edit loop): reinstall or reload instead of 'already configured'", async () => {
    expect((await installPlugin(EXAMPLE, { name, log: () => {} })).status).toBe("running");
    expect((await installPlugin(EXAMPLE, { name, log: () => {} })).status).toBe("running");
  }, 120_000);

  it("surfaces a plugin whose client failed to evaluate (unknown icon): install says running, web says no errors", async () => {
    const dir = join(scratch("ppd-review-e2e-"), "bad-icon");
    cpSync(EXAMPLE, dir, { recursive: true });
    const entry = join(dir, "index.client.tsx");
    writeFileSync(entry, readFileSync(entry, "utf8").replace('icon: "Hand"', 'icon: "HandWave"'));
    const result = await installPlugin(dir, { name, id: "bad-icon", log: () => {} });
    const web = await PaseoWeb.launch({ url });
    try {
      await web.page.waitForTimeout(3000);
      // Either signal would do: install not reporting "running", or PaseoWeb collecting the app's
      // "[Plugins] Failed to evaluate" warning (packages/app/src/plugins/registry.ts).
      expect(result.status !== "running" || web.errors.some((error) => /Failed to evaluate/.test(error))).toBe(true);
    } finally {
      await web.close();
    }
  }, 180_000);
});

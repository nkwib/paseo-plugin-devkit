// Opt-in (PPD_E2E=1) review findings that need a real Paseo daemon and Chrome (fixed; kept as regressions).
// Port: PPD_E2E_PORT (default 7834) so the run stays on one known port. With e2e.test.ts on the same port run
// files one at a time: PPD_E2E=1 PPD_E2E_PORT=7838 npx vitest run --no-file-parallelism
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { daemonDown, daemonUp } from "../src/daemon.ts";
import { devLoop } from "../src/dev.ts";
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

  it("ppd dev reloads on a change and reports a client the app would reject", async () => {
    const dir = join(scratch("ppd-review-e2e-"), "dev");
    cpSync(EXAMPLE, dir, { recursive: true });
    const lines: string[] = [];
    let stop = () => {};
    const until = new Promise<void>((resolve) => (stop = resolve));
    const loop = devLoop(dir, { name, id: "dev-loop", debounceMs: 100, log: (line) => lines.push(line), until });
    const waitFor = async (pattern: RegExp) => {
      for (let i = 0; i < 120 && !lines.some((line) => pattern.test(line)); i++) await new Promise((resolve) => setTimeout(resolve, 250));
      expect(lines.join("\n")).toMatch(pattern);
    };
    try {
      await waitFor(/^watching /);
      expect(lines.join("\n")).toMatch(/dev-loop: running \(installed\)/);
      const entry = join(dir, "index.client.tsx");
      writeFileSync(entry, readFileSync(entry, "utf8").replace('icon: "Hand"', 'icon: "HandWave"'));
      await waitFor(/dev-loop: client-rejected \(reloaded\)/);
      expect(lines.join("\n")).toMatch(/Unknown Lucide icon: HandWave/);
    } finally {
      stop();
      await loop;
    }
  }, 120_000);
});

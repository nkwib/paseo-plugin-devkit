import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { daemonDown, daemonUp } from "../src/daemon.ts";
import { installPlugin } from "../src/install.ts";
import { findPaseoBin, runPaseo } from "../src/paseo.ts";
import { PaseoWeb } from "../src/web.ts";
import { CLI, FIXTURES, scratch } from "./helpers.ts";

const enabled = process.env.PPD_E2E === "1" && findPaseoBin() !== null;
const name = `file-panels-${process.pid}`;

describe.skipIf(!enabled)("native file-tab helpers (PPD_E2E=1)", () => {
  let web: PaseoWeb | undefined;
  let workspace: string;
  const previousState = process.env.PPD_STATE_DIR;
  const previousXdg = process.env.XDG_STATE_HOME;

  beforeAll(async () => {
    process.env.PPD_STATE_DIR = scratch("ppd-file-panels-state-");
    process.env.XDG_STATE_HOME = scratch("ppd-file-panels-xdg-");
    workspace = scratch("ppd-file-panels-workspace-");
    mkdirSync(join(workspace, "reports"));
    mkdirSync(join(workspace, "archive/reports"), { recursive: true });
    writeFileSync(join(workspace, "archive/reports/live.csv"), "Nested decoy,0\n");
    writeFileSync(join(workspace, "reports/live.csv"), "Before rewrite,1\n");
    writeFileSync(join(workspace, "live.csv"), "Root decoy,0\n");
    // More files than the virtualized Files tree renders at once.
    for (let index = 0; index < 400; index++) writeFileSync(join(workspace, `filler-${String(index).padStart(3, "0")}.txt`), "");
    writeFileSync(join(workspace, "zz-last.csv"), "Last row,4\n");
    const daemon = await daemonUp({ name, workspace, log: () => {} });
    const cli = (args: string[]) => {
      const result = runPaseo(daemon.paseoBin, daemon.home, [...args, "--json"]);
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    expect((await installPlugin(join(FIXTURES, "file-panel"), { name, log: () => {} })).status).toBe("running");
    const { serverId } = cli(["daemon", "status"]);
    const selected = cli(["workspace", "ls"]).find((entry: { cwd: string }) => entry.cwd === workspace);
    expect(selected).toBeDefined();
    web = await PaseoWeb.launch({ url: daemon.url });
    await web.openWorkspace(serverId, selected.workspaceId);
  }, 180_000);

  afterAll(async () => {
    try {
      await web?.close();
    } finally {
      await daemonDown({ name, log: () => {} });
      if (previousState === undefined) delete process.env.PPD_STATE_DIR;
      else process.env.PPD_STATE_DIR = previousState;
      if (previousXdg === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousXdg;
    }
  });

  afterEach(async (context) => {
    if (context.task.result?.state === "fail" && web) {
      console.error(await web.page.locator("body").ariaSnapshot());
      console.error("Plugin errors:", web.pluginErrors, "Console errors:", web.errors);
    }
  });

  it("distinguishes duplicate folder and file names in a collapsed tree", async () => {
    await web!.openFile("archive/reports/live.csv", { panel: "Fixture" });
    await expect.poll(() => web!.page.getByText("Nested decoy,0", { exact: true }).isVisible()).toBe(true);
    await web!.closeFile("archive/reports/live.csv");
  });

  it("finds a row beyond the rendered part of a long tree", async () => {
    await web!.openFile("zz-last.csv", { panel: "Fixture" });
    await expect.poll(() => web!.page.getByText("Last row,4", { exact: true }).isVisible()).toBe(true);
    await web!.closeFile("zz-last.csv");
    await expect(web!.openFile("missing.csv")).rejects.toThrow(/did not list missing\.csv/);
  }, 120_000);

  it("opens a nested file, selects a panel, watches changes, restores a pinned tab, switches panels and closes it", async () => {
    const ui = web!;
    await expect(ui.openFile("../outside.csv")).rejects.toThrow(/workspace-relative/);
    await ui.openFile("reports/live.csv", { panel: "Fixture", remember: true });
    await ui.pinFile("reports/live.csv");
    await expect.poll(() => ui.page.getByText("Before rewrite,1", { exact: true }).isVisible()).toBe(true);
    writeFileSync(join(workspace, "reports/live.csv"), "After rewrite,2\n");
    await expect.poll(() => ui.page.getByText("After rewrite,2", { exact: true }).isVisible()).toBe(true);
    rmSync(join(workspace, "reports/live.csv"));
    await expect.poll(() => ui.page.getByText("Fixture file unavailable", { exact: true }).isVisible()).toBe(true);
    writeFileSync(join(workspace, "reports/live.csv"), "Restored file,3\n");
    await expect.poll(() => ui.page.getByText("Restored file,3", { exact: true }).isVisible()).toBe(true);
    await ui.reload();
    await expect.poll(() => ui.fileTab("reports/live.csv").isVisible()).toBe(true);
    await expect.poll(() => ui.page.getByText("Restored file,3", { exact: true }).isVisible()).toBe(true);
    await ui.openWith("reports/live.csv", "Source");
    await ui.openWith("reports/live.csv", "Fixture \u2014 file-panel-fixture");
    await expect.poll(() => ui.page.getByText("Restored file,3", { exact: true }).isVisible()).toBe(true);
    await ui.closeFile("reports/live.csv");
    expect(await ui.fileTab("reports/live.csv").count()).toBe(0);
    await ui.openFile("reports/live.csv");
    await expect.poll(() => ui.page.getByText("Restored file,3", { exact: true }).isVisible()).toBe(true);
    expect(await ui.page.getByRole("dialog").count()).toBe(0);
    await ui.closeFile("reports/live.csv");
    await expect(ui.openFile("reports/live.csv", { panel: "Fixture" })).rejects.toThrow(/no panel picker appeared/);
    await ui.closeFile("reports/live.csv");
    const cli = spawnSync(process.execPath, [CLI, "web", "--name", name, "--workspace", workspace,
      "--open-file", "reports/live.csv", "--with", "Fixture", "--shot", join(scratch("ppd-file-panels-shots-"), "file.png")],
    { encoding: "utf8", timeout: 60_000 });
    expect(cli.status, cli.stderr || cli.stdout).toBe(0);
    expect(cli.stdout).toContain("plugin evaluation errors: none");
    expect(ui.pluginErrors).toEqual([]);
    expect(ui.errors).toEqual([]);
  }, 120_000);
});

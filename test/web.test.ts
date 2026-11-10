import { describe, expect, it } from "vitest";
import { noWorkspaceNote, pluginEvaluationFailure, isCompactViewport, parseViewport, pickPanel, pickWorkspace } from "../src/web.ts";

describe("web helpers", () => {
  it("reads the app's plugin evaluation warning (packages/app/src/plugins/registry.ts)", () => {
    const text = "[Plugins] Failed to evaluate srv_CzB_YUiq_IOy/bad-icon Error: Unknown Lucide icon: HandWave\n    at _e.resolvePluginIcon (http://x/index.js:1:2)";
    expect(pluginEvaluationFailure(text)).toBe("bad-icon: Error: Unknown Lucide icon: HandWave");
    expect(pluginEvaluationFailure("[Plugins] API cleanup failed for srv/x")).toBeNull();
  });

  it("parses viewports", () => {
    expect(parseViewport("390x844")).toEqual({ width: 390, height: 844 });
    expect(() => parseViewport("390*844")).toThrow(/390x844/);
    expect(isCompactViewport({ width: 390, height: 844 })).toBe(true);
    expect(isCompactViewport({ width: 1400, height: 900 })).toBe(false);
  });

  it("picks a workspace by id, name or path, or the only one", () => {
    const entries = [
      { workspaceId: "wks_1", name: "docs", cwd: "/w/docs" },
      { workspaceId: "wks_2", name: "app", cwd: "/w/app" },
    ];
    expect(pickWorkspace(entries, "wks_2")?.name).toBe("app");
    expect(pickWorkspace(entries, "docs")?.workspaceId).toBe("wks_1");
    expect(pickWorkspace(entries, "/w/app")?.workspaceId).toBe("wks_2");
    expect(pickWorkspace(entries)).toBeNull();
    expect(pickWorkspace([entries[0]!])?.workspaceId).toBe("wks_1");
    // `paseo run --cwd` makes a second workspace for a directory: say so instead of opening nothing silently.
    expect(noWorkspaceNote(entries)).toBe("2 workspaces on the dev daemon, none opened: pass --workspace <id, name or dir> (ids: wks_1, wks_2)");
    expect(noWorkspaceNote([])).toMatch(/^no workspace on the dev daemon/);
  });

  it("picks a panel by unique title or full label, and lists the options when a title is ambiguous", () => {
    const offered = ["Source", "Viewer \u2014 doc-viewer", "Viewer \u2014 csv-viewer", "Chart \u2014 csv-viewer"];
    expect(pickPanel("Source", offered)).toBe("Source");
    expect(pickPanel("Chart", offered)).toBe("Chart \u2014 csv-viewer");
    expect(pickPanel("Viewer \u2014 csv-viewer", offered)).toBe("Viewer \u2014 csv-viewer");
    expect(() => pickPanel("Viewer", offered)).toThrow(
      'the panel picker offers 2 panels titled "Viewer": Viewer \u2014 doc-viewer, Viewer \u2014 csv-viewer. Pass the full label, such as "Viewer \u2014 doc-viewer"',
    );
    expect(() => pickPanel("View", offered)).toThrow(/offers no panel named "View"; it offers: Source, Viewer/);
    expect(() => pickPanel("Viewer \u2014 csv", offered)).toThrow(/no panel named/);
    expect(() => pickPanel("Viewer", offered, 'the "Open with" menu')).toThrow(/^the "Open with" menu offers 2 panels titled "Viewer"/);
    const twins = ["Viewer \u2014 doc-viewer", "Viewer \u2014 doc-viewer", "Source \u2014 Paseo"];
    for (const name of ["Viewer", "Viewer \u2014 doc-viewer"]) {
      expect(() => pickPanel(name, twins)).toThrow('the panel picker offers 2 panels labelled "Viewer \u2014 doc-viewer", which ppd cannot tell apart; give the panels distinct titles');
    }
  });
});

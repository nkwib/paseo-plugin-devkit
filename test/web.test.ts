import { describe, expect, it } from "vitest";
import { isCompactViewport, parseViewport, pickWorkspace } from "../src/web.ts";

describe("web helpers", () => {
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
  });
});

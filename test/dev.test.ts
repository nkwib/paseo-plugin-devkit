import { describe, expect, it } from "vitest";
import { isIgnoredChange, newLogLines, reloadLimiter } from "../src/dev.ts";
import { cliErrorMessage } from "../src/install.ts";

describe("ppd dev", () => {
  it("holds back a self-triggering reload loop, then resumes", () => {
    const allow = reloadLimiter(3, 1000);
    expect([0, 100, 200].map(allow)).toEqual([true, true, true]);
    expect(allow(300)).toBe(false);
    expect(allow(900)).toBe(false);
    expect(allow(1301)).toBe(true);
  });

  it("ignores dependency, VCS, build and editor changes", () => {
    for (const path of ["node_modules/x/index.js", ".git/index", "dist/server.js", "src/.index.ts.swp", "index.ts~", "a/.cache/b"]) {
      expect(isIgnoredChange(path), path).toBe(true);
    }
    for (const path of ["index.client.tsx", "server/handlers.ts", "paseo-plugin.json", "assets/icon.png"]) {
      expect(isIgnoredChange(path), path).toBe(false);
    }
  });

  it("prints each plugin log line once and skips the header", () => {
    const seen = new Set<string>();
    const first = "TIME  STREAM  MESSAGE\n2026-10-17T22:06:05Z  stdout  Loading plugin\n";
    expect(newLogLines(first, seen)).toEqual(["2026-10-17T22:06:05Z  stdout  Loading plugin"]);
    expect(newLogLines(`${first}2026-10-17T22:06:06Z  stdout  Plugin ready\n`, seen)).toEqual(["2026-10-17T22:06:06Z  stdout  Plugin ready"]);
  });

  it("extracts the message of a JSON CLI failure", () => {
    const output = JSON.stringify({
      error: { name: "DaemonRpcError", message: 'Request failed: Build failed with 1 error:\nindex.server.ts:9:22: ERROR: Unexpected ";" requestType=plugin.reload.request code=handler_error' },
    });
    expect(cliErrorMessage(output)).toBe('Build failed with 1 error:\nindex.server.ts:9:22: ERROR: Unexpected ";"');
    expect(cliErrorMessage("plain failure\n")).toBe("plain failure");
  });
});

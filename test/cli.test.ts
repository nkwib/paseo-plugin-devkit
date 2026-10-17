import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CLI, scratch } from "./helpers.ts";

const ppd = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, PPD_STATE_DIR: scratch("ppd-cli-state-") } });

describe("ppd CLI guards", () => {
  it("refuses port 6767 with exit code 3 before starting anything", () => {
    const result = ppd("daemon", "up", "--port", "6767");
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/refused: refusing port 6767/);
  });

  it("needs a running dev daemon for install and paseo passthrough", () => {
    expect(ppd("install", ".").stderr).toMatch(/no running dev daemon/);
    expect(ppd("paseo", "--", "plugin", "ls").stderr).toMatch(/no running dev daemon/);
  });

  it("prints help and rejects unknown commands", () => {
    expect(ppd("help").stdout).toMatch(/never port 6767, never ~\/.paseo/);
    expect(ppd("frobnicate").status).toBe(1);
  });
});

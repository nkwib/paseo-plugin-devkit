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

  it("refuses port 6767 for android reverse", () => {
    const result = ppd("android", "up", "--port", "6767");
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/refusing port 6767/);
  });

  it("prints help and rejects unknown commands", () => {
    expect(ppd("--help").stdout).toMatch(/never port 6767, never ~\/.paseo/);
    const unknown = ppd("frobnicate");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/unknown command: frobnicate\nrun `ppd --help`/);
  });

  it("prints per-command help without running the command", () => {
    for (const command of ["daemon", "install", "paseo", "web", "android", "doctor", "check", "release", "registry"]) {
      const viaFlag = ppd(command, "--help");
      expect(viaFlag.status, command).toBe(0);
      expect(viaFlag.stdout, command).toMatch(new RegExp(`^ppd ${command}`));
      expect(ppd("help", command).stdout).toBe(viaFlag.stdout);
    }
    expect(ppd("daemon", "up", "-h").stdout).toMatch(/--workspace DIR/);
  });

  it("points bad options and values at the command's help", () => {
    const unknown = ppd("check", "--frob");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown option '--frob'[\s\S]*run `ppd check --help`/);
    expect(ppd("check", "--max-client-kb", "lots").stderr).toMatch(/--max-client-kb must be a whole number of KiB/);
  });
});

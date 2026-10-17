import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDaemonConfig, daemonDown, pickPort, readDaemon, type DaemonRecord } from "../src/daemon.ts";
import { HOME_MARKER, SafetyError } from "../src/safety.ts";
import { scratch } from "./helpers.ts";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.PPD_STATE_DIR;
  process.env.PPD_STATE_DIR = scratch("ppd-state-");
});
afterEach(() => {
  if (previous === undefined) delete process.env.PPD_STATE_DIR;
  else process.env.PPD_STATE_DIR = previous;
});

function writeRecord(record: Partial<DaemonRecord>): void {
  const dir = join(process.env.PPD_STATE_DIR!, "daemons");
  mkdirSync(dir, { recursive: true });
  const full: DaemonRecord = {
    name: "t",
    pid: 999999,
    port: 7800,
    home: "/nonexistent",
    url: "http://127.0.0.1:7800",
    paseoBin: "paseo",
    paseoVersion: null,
    webDist: null,
    startedAt: new Date().toISOString(),
    ...record,
  };
  writeFileSync(join(dir, `${full.name}.json`), JSON.stringify(full));
}

describe("pickPort", () => {
  it("never picks 6767 and skips busy ports", async () => {
    const busy = new Set([7800, 7801]);
    expect(await pickPort(undefined, async (port) => !busy.has(port))).toBe(7802);
  });

  it("refuses an explicit 6767 before probing it", async () => {
    let probed = false;
    await expect(pickPort(6767, async () => ((probed = true), true))).rejects.toThrow(SafetyError);
    expect(probed).toBe(false);
  });

  it("refuses an explicit port that is in use", async () => {
    await expect(pickPort(7810, async () => false)).rejects.toThrow(/in use/);
  });
});

describe("buildDaemonConfig", () => {
  it("enables plugins, disables relay, MCP and speech, and wires the web UI", () => {
    const config = buildDaemonConfig("127.0.0.1:7800", "/Apps/Paseo.app/Contents/Resources/app-dist") as Record<string, any>;
    expect(config.pluginsEnabled).toBe(true);
    expect(config.daemon).toEqual({ listen: "127.0.0.1:7800", relay: { enabled: false }, mcp: { enabled: false } });
    expect(config.features.dictation.enabled).toBe(false);
    expect(config.features.voiceMode.enabled).toBe(false);
    expect(config.features.webUi).toEqual({ enabled: true, distDir: "/Apps/Paseo.app/Contents/Resources/app-dist" });
    expect((buildDaemonConfig("127.0.0.1:7800", null) as Record<string, any>).features.webUi).toBeUndefined();
  });
});

describe("daemonDown", () => {
  it("refuses a record whose home is the real Paseo home and deletes nothing", async () => {
    writeRecord({ name: "evil", home: join(homedir(), ".paseo") });
    await expect(daemonDown({ name: "evil", log: () => {} })).rejects.toThrow(SafetyError);
    expect(readDaemon("evil")).not.toBeNull();
  });

  it("does not signal a live pid that is not its daemon, and keeps homes without the marker", async () => {
    const home = scratch("ppd-down-");
    writeRecord({ name: "other", pid: process.pid, home });
    const lines: string[] = [];
    await daemonDown({ name: "other", log: (line) => lines.push(line) });
    expect(lines.join("\n")).toMatch(/not this dev daemon; not signalling/);
    expect(existsSync(home)).toBe(true);
    expect(readDaemon("other")).toBeNull();
  });

  it("removes a marked temp home of a dead daemon", async () => {
    const home = scratch("ppd-down-");
    writeFileSync(join(home, HOME_MARKER), "x");
    writeRecord({ name: "dead", pid: 999999, home });
    await daemonDown({ name: "dead", log: () => {} });
    expect(existsSync(home)).toBe(false);
  });

  it("rejects state names that could escape the state dir", async () => {
    expect(() => readDaemon("../x")).toThrow(SafetyError);
  });
});

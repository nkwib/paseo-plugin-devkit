import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeHome,
  assertSafePort,
  commandUsesHome,
  devDaemonEnv,
  parsePort,
  paseoArgsForHome,
  REAL_DAEMON_PORT,
  SafetyError,
  type HomeContext,
} from "../src/safety.ts";
import { scratch } from "./helpers.ts";

function context(): HomeContext & { temp: string } {
  const root = scratch();
  const userHome = join(root, "user");
  const temp = join(root, "tmp");
  mkdirSync(join(userHome, ".paseo"), { recursive: true });
  mkdirSync(temp, { recursive: true });
  return { userHome, tempRoots: [temp], temp };
}

describe("ports", () => {
  it("refuses the real daemon port 6767", () => {
    expect(REAL_DAEMON_PORT).toBe(6767);
    expect(() => assertSafePort(6767)).toThrow(SafetyError);
    expect(() => parsePort("6767")).toThrow(/real Paseo daemon/);
  });

  it("refuses privileged, out-of-range and non-numeric ports", () => {
    for (const port of [0, 80, 1023, 65536, 7800.5]) expect(() => assertSafePort(port)).toThrow(SafetyError);
    expect(() => parsePort("78a0")).toThrow(SafetyError);
  });

  it("accepts ordinary dev ports", () => {
    expect(parsePort("7811")).toBe(7811);
  });
});

describe("homes", () => {
  it("refuses the real Paseo home and anything inside it", () => {
    const ctx = context();
    expect(() => assertSafeHome(join(ctx.userHome, ".paseo"), ctx, {})).toThrow(/real Paseo home/);
    expect(() => assertSafeHome(join(ctx.userHome, ".paseo/plugins"), ctx, {})).toThrow(/real Paseo home/);
  });

  it("refuses a temp symlink that points into the real Paseo home", () => {
    const ctx = context();
    const link = join(ctx.temp, "sneaky");
    symlinkSync(join(ctx.userHome, ".paseo"), link);
    expect(() => assertSafeHome(link, ctx, {})).toThrow(/real Paseo home/);
  });

  it("refuses a parent of the real Paseo home", () => {
    const ctx = context();
    expect(() => assertSafeHome(ctx.userHome, ctx, {})).toThrow(SafetyError);
  });

  it("refuses PASEO_HOME from the shell when it is not a temp dir", () => {
    const ctx = context();
    const custom = join(ctx.userHome, "other-paseo");
    const nestedTemp = join(custom, "tmp");
    mkdirSync(join(nestedTemp, "h"), { recursive: true });
    const nested = { ...ctx, tempRoots: [nestedTemp] };
    expect(assertSafeHome(join(nestedTemp, "h"), nested, {})).toBe(join(nestedTemp, "h"));
    expect(() => assertSafeHome(join(nestedTemp, "h"), nested, { PASEO_HOME: custom })).toThrow(/real Paseo home/);
  });

  it("refuses non-temp directories and the temp root itself", () => {
    const ctx = context();
    expect(() => assertSafeHome(join(ctx.userHome, "projects/x"), ctx, {})).toThrow(/temp directory/);
    expect(() => assertSafeHome(ctx.temp, ctx, {})).toThrow(/temp directory/);
    expect(() => assertSafeHome("/", ctx, {})).toThrow(SafetyError);
  });

  it("accepts a fresh directory under a temp root and returns its canonical path", () => {
    const ctx = context();
    const home = join(ctx.temp, "ppd-default-abc");
    mkdirSync(home);
    expect(assertSafeHome(home, ctx, {})).toBe(home);
  });
});

describe("process ownership", () => {
  it("matches only the exact --home argument", () => {
    const cmd = "/Applications/Paseo.app/Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper index.js daemon run --home /tmp/ppd-a";
    expect(commandUsesHome(cmd, "/tmp/ppd-a")).toBe(true);
    expect(commandUsesHome(cmd, "/tmp/ppd")).toBe(false);
    expect(commandUsesHome("paseo daemon run", "/tmp/ppd-a")).toBe(false);
    expect(commandUsesHome("paseo daemon run --home=/tmp/ppd-a", "/tmp/ppd-a")).toBe(true);
  });
});

describe("Paseo CLI targeting", () => {
  it("always appends the dev home", () => {
    expect(paseoArgsForHome(["plugin", "ls"], "/tmp/h")).toEqual(["plugin", "ls", "--home", "/tmp/h"]);
  });

  it("rejects caller flags that could retarget the real daemon", () => {
    expect(() => paseoArgsForHome(["plugin", "ls", "--host", "127.0.0.1:6767"], "/tmp/h")).toThrow(SafetyError);
    expect(() => paseoArgsForHome(["--host=localhost:6767"], "/tmp/h")).toThrow(SafetyError);
    expect(() => paseoArgsForHome(["--home", "~/.paseo"], "/tmp/h")).toThrow(SafetyError);
  });

  it("drops PASEO_HOST and pins PASEO_HOME for child processes", () => {
    const env = devDaemonEnv({ PASEO_HOST: "127.0.0.1:6767", PASEO_HOME: "/Users/x/.paseo", PATH: "/bin" }, "/tmp/h", { PASEO_LISTEN: "127.0.0.1:7800" });
    expect(env.PASEO_HOST).toBeUndefined();
    expect(env.PASEO_HOME).toBe("/tmp/h");
    expect(env.PASEO_LISTEN).toBe("127.0.0.1:7800");
  });

  it("drops the caller's PASEO_* agent variables (they used to leak into the test daemon)", () => {
    const env = devDaemonEnv({ PASEO_AGENT_ID: "a1", PASEO_AGENT_CWD: "/w", PASEO_CLI: "/x/paseo", PASEO_NODE_ENV: "development", PATH: "/bin" }, "/tmp/h");
    expect(Object.keys(env).sort()).toEqual(["PASEO_HOME", "PASEO_NODE_ENV", "PATH"]);
  });
});

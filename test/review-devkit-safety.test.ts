// Repro tests from the review-next lane, third pass (devkit safety). `it.fails` documents a confirmed gap and passes
// while it exists; plain `it` pins a bypass attempt that the guards already stop. Nothing here starts a daemon,
// binds a port, or points at the real ~/.paseo: homes are fake (HomeContext) and records name a scratch state dir.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateIsolated } from "../src/check/isolate.ts";
import { requireDaemon } from "../src/daemon.ts";
import { assertSafeHome, parsePort, SafetyError, type HomeContext } from "../src/safety.ts";

// The SDK provider module is supplied by the host at runtime; only the plugin's own guard is under test.
vi.mock("@getpaseo/plugin/server/provider", () => ({ negotiateProviderCapabilities: () => [], requireProviderCapabilities: () => {} }));

const saved = { ...process.env };
const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratchDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

describe("review-devkit-safety: guards that hold", () => {
  it("refuses 6767 spelled with a leading zero or spaces", () => {
    for (const value of ["06767", " 6767", "6767 ", "6767.0", "+6767"]) expect(() => parsePort(value)).toThrow(SafetyError);
  });

  it("refuses a temp symlink or relative path that resolves into the (fake) user's .paseo", () => {
    const root = scratchDir("ppd-review-");
    const userHome = join(root, "user");
    mkdirSync(join(userHome, ".paseo"), { recursive: true });
    const temp = join(root, "tmp");
    mkdirSync(temp);
    const context: HomeContext = { userHome, tempRoots: [temp] };
    symlinkSync(join(userHome, ".paseo"), join(temp, "link"));
    expect(() => assertSafeHome(join(temp, "link"), context, {})).toThrow(SafetyError);
    expect(() => assertSafeHome(join(temp, "link", "sub"), context, {})).toThrow(SafetyError);
    expect(() => assertSafeHome(`${temp}/x/../../user/.paseo`, context, {})).toThrow(SafetyError);
  });
});

describe("review-devkit-safety: gaps", () => {
  it.fails("ppd check does not hand inherited PASEO_* variables to the plugin code it evaluates", async () => {
    // Stand-ins for what an agent running inside Paseo inherits; neither names the real daemon here.
    process.env.PASEO_HOME = "/tmp/ppd-review-fake-caller-home";
    process.env.PASEO_LISTEN = "127.0.0.1:7846";
    const bundle = `(function (require) { return { default: function (server) {
      const keys = Object.keys(process.env).filter((key) => key.startsWith("PASEO_")).sort().join(",");
      server.handle(keys || "none", () => null);
    } }; })`;
    const outcome = await evaluateIsolated("server", bundle, scratchDir("ppd-review-plugin-"));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && "handlers" in outcome.result ? outcome.result.handlers : null).toEqual(["none"]);
  }, 60_000);

  it.fails("the fake agent (bash run: true) refuses to register outside a ppd-created home", async () => {
    // A home without the .ppd-home marker, as the user's daemon would have.
    process.env.PASEO_HOME = scratchDir("ppd-review-not-ppd-");
    const providers: unknown[] = [];
    let refused = false;
    // A computed specifier keeps the plugin asset (built by the host, not by this tsconfig) out of the typecheck.
    const asset = new URL("../assets/fake-agent/index.server.ts", import.meta.url).href;
    const { default: contributeFakeAgent } = (await import(asset)) as { default: (server: unknown) => void };
    try {
      contributeFakeAgent({ registerProvider: (provider: unknown) => providers.push(provider) });
    } catch {
      refused = true;
    }
    expect(refused || providers.length === 0).toBe(true);
  });

  it.fails("requireDaemon rejects a record whose url does not match its checked port", async () => {
    const state = scratchDir("ppd-review-state-");
    const home = scratchDir("ppd-review-home-");
    process.env.PPD_STATE_DIR = state;
    // A live process whose command line names the home, as isDaemonLive expects; it never listens.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--home", home], { stdio: "ignore" });
    children.push(child);
    await new Promise((resolve) => setTimeout(resolve, 300));
    mkdirSync(join(state, "daemons"), { recursive: true });
    const record = { name: "review", pid: child.pid, port: 7846, home, url: "http://127.0.0.1:6767", paseoBin: "/nonexistent", paseoVersion: null, webDist: null, startedAt: new Date().toISOString() };
    writeFileSync(join(state, "daemons", "review.json"), JSON.stringify(record));
    // ppd web opens record.url after this check (src/web.ts:213).
    expect(() => requireDaemon("review")).toThrow(SafetyError);
  });
});

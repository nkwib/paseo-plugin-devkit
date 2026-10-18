// Safety regression tests from a review of the devkit's guards. Each one pins a bypass attempt that the guards
// stop. Nothing here starts a daemon, binds a port, or points at the real ~/.paseo: homes are fake (HomeContext)
// and records name a scratch state dir.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateIsolated, runChild } from "../src/check/isolate.ts";
import { requireDaemon } from "../src/daemon.ts";
import { assertSafeHome, HOME_MARKER, parsePort, SafetyError, type HomeContext } from "../src/safety.ts";

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
  it("ppd check does not hand inherited PASEO_* variables to the plugin code it evaluates", async () => {
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

  it("runChild drops PASEO_* even from an env the caller passes (host compile path)", async () => {
    const script = `process.stderr.write(Object.keys(process.env).filter((key) => key.startsWith("PASEO_")).join(",") || "none")`;
    const outcome = await runChild(process.execPath, ["-e", script], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH, PASEO_HOME: "/tmp/ppd-review-fake-caller-home", PASEO_AGENT_ID: "a1", ELECTRON_RUN_AS_NODE: "1" },
      timeoutMs: 30_000,
    });
    expect(outcome.stderr).toBe("none");
  }, 60_000);

  // A plain `paseo plugin install` puts the plugin in a daemon whose home has no .ppd-home; the plugin process
  // inherits the daemon's env (upstream server/plugins/runtime.ts forks without an env), so PASEO_HOME is that home.
  describe("fake agent shell steps", () => {
    type Item = { type: string; status?: string; error?: string | null; detail?: { output?: string; exitCode?: number } };
    const provider = async () => {
      const asset = new URL("../assets/fake-agent/server/provider.ts", import.meta.url).href;
      return (await import(asset)) as {
        chooseScript(text: string, cwd: string, turn: number): { steps: unknown[] };
        runStep(step: unknown, id: string, session: unknown, item: (value: Item) => void, signal: AbortSignal): Promise<string | null>;
      };
    };
    const runAll = async (steps: unknown[], cwd: string) => {
      const { runStep } = await provider();
      const items: Item[] = [];
      const session = { config: { cwd, mcpServers: {}, env: {} }, persistence: null, turn: 1, abort: null };
      for (const [index, step] of steps.entries()) {
        const failed = await runStep(step, `1-${index}`, session, (value) => items.push(value), new AbortController().signal);
        if (failed !== null) return { failed, items };
      }
      return { failed: null, items };
    };
    const proofStep = { bash: { command: "echo ran > proof.txt", run: true } };

    it("uses the marker name ppd writes into its homes", async () => {
      const asset = new URL("../assets/fake-agent/server/isolation.ts", import.meta.url).href;
      expect(((await import(asset)) as { PPD_HOME_MARKER: string }).PPD_HOME_MARKER).toBe(HOME_MARKER);
    });

    it("refuses run: true in a daemon whose home ppd did not create", async () => {
      process.env.PASEO_HOME = scratchDir("ppd-review-user-home-");
      const cwd = scratchDir("ppd-review-cwd-");
      const { failed, items } = await runAll([proofStep], cwd);
      expect(failed).toMatch(/refused/);
      expect(items).toEqual([expect.objectContaining({ type: "tool_call", status: "failed", detail: expect.objectContaining({ exitCode: 126 }) })]);
      expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
    });

    it("refuses run: true when PASEO_HOME is unset", async () => {
      delete process.env.PASEO_HOME;
      const cwd = scratchDir("ppd-review-cwd-");
      expect((await runAll([proofStep], cwd)).failed).toMatch(/refused/);
      expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
    });

    it("refuses shell steps from a repository's .fake-agent.json too", async () => {
      process.env.PASEO_HOME = scratchDir("ppd-review-user-home-");
      const cwd = scratchDir("ppd-review-cwd-");
      writeFileSync(join(cwd, ".fake-agent.json"), JSON.stringify({ turns: [[{ say: "hi" }, proofStep]] }));
      const { chooseScript } = await provider();
      const { failed } = await runAll(chooseScript("plain prompt", cwd, 1).steps, cwd);
      expect(failed).toMatch(/refused/);
      expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
    });

    it("runs run: true in a ppd dev daemon (home with the marker)", async () => {
      const home = scratchDir("ppd-review-dev-home-");
      writeFileSync(join(home, HOME_MARKER), "created by the test\n");
      process.env.PASEO_HOME = home;
      const cwd = scratchDir("ppd-review-cwd-");
      expect((await runAll([proofStep], cwd)).failed).toBeNull();
      expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("ran\n");
    });
  });

  it("requireDaemon rejects a record whose url does not match its checked port", async () => {
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
    writeFileSync(join(state, "daemons", "review.json"), JSON.stringify({ ...record, url: "http://127.0.0.1:7846/" }));
    expect(requireDaemon("review").port).toBe(7846);
  });
});

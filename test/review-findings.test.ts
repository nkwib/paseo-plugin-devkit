// Confirmed bugs and host-contract drift from the 2026-10-17 deep review. Each test states the correct
// behavior and is marked `it.fails` while the bug stands, so `npm test` stays green. Fixing a bug makes its
// test "unexpectedly pass": then drop the `.fails`.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runChecks } from "../src/check/index.ts";
import { daemonUp } from "../src/daemon.ts";
import { installSource } from "../src/install.ts";
import { findPaseoBin } from "../src/paseo.ts";
import { precheck } from "../src/registry/precheck.ts";
import { HOME_MARKER } from "../src/safety.ts";
import { CLI, EXAMPLE, scratch } from "./helpers.ts";

/** A copy of the example plugin with edits applied: file -> new content, or file -> [search, replace]. */
function variant(edits: Record<string, string | [string | RegExp, string]>): string {
  const dir = join(scratch("ppd-review-"), "plugin");
  cpSync(EXAMPLE, dir, { recursive: true });
  for (const [file, edit] of Object.entries(edits)) {
    const path = join(dir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof edit === "string" ? edit : readFileSync(path, "utf8").replace(edit[0], edit[1]));
  }
  return dir;
}

function manifestWith(patch: Record<string, unknown>): string {
  const manifest = JSON.parse(readFileSync(join(EXAMPLE, "paseo-plugin.json"), "utf8"));
  return variant({ "paseo-plugin.json": JSON.stringify({ ...manifest, ...patch }) });
}

/** The CLI without PASEO_SOURCE, so the approximate path runs on every machine. */
function ppd(args: string[], timeout = 20_000) {
  const env: NodeJS.ProcessEnv = { ...process.env, PPD_STATE_DIR: scratch("ppd-review-state-") };
  delete env.PASEO_SOURCE;
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, timeout });
}

const byId = async (dir: string) => new Map((await runChecks(dir, { paseoSource: null })).map((result) => [result.id, result]));

describe("ppd check runs plugin code in its own process", () => {
  it("exits when the server contribution starts a timer", () => {
    const dir = variant({
      "index.server.ts": [
        "server.handle(greetRpc, ({ name }) => greet(name));\n  return () => {};",
        "server.handle(greetRpc, ({ name }) => greet(name));\n  const timer = setInterval(() => {}, 60_000);\n  return () => clearInterval(timer);",
      ],
    });
    const result = ppd(["check", dir], 15_000);
    expect(result.error, "ppd check was killed by the 15 s timeout").toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("does not report success when plugin code calls process.exit(0) at load", () => {
    const dir = variant({ "server/greet.ts": [/$/, "\nprocess.exit(0);\n"] });
    const result = ppd(["check", dir]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/FAIL\s+server-eval.*process\.exit\(0\)/);
  });

  it("fails, instead of hanging, when client code loops forever at load", async () => {
    const dir = variant({ "client/hello-panel.tsx": [/$/, "\nwhile (Date.now() > 0) {}\n"] });
    const results = await runChecks(dir, { paseoSource: null, evalTimeoutMs: 2000 });
    expect(results.find((result) => result.id === "client-eval")).toMatchObject({ status: "fail", message: expect.stringMatching(/did not finish within 2 s/) });
  });

  it("fails a server contribution that returns no cleanup function (plugin-process.ts)", async () => {
    const dir = variant({ "index.server.ts": ["return () => {};", "return undefined as never;"] });
    expect((await byId(dir)).get("server-eval")).toMatchObject({ status: "fail", message: expect.stringContaining("cleanup") });
  });
});

describe("ppd check messages", () => {
  it.fails("shows where an esbuild compile error is, not only 'Build failed with 1 error:'", async () => {
    const dir = variant({ "client/hello-panel.tsx": [/$/, "\nexport const broken = ;\n"] });
    const compile = (await byId(dir)).get("approx-compile")!;
    expect(compile.status).toBe("fail");
    expect([compile.message, ...(compile.details ?? [])].join("\n")).toMatch(/hello-panel\.tsx:\d+:\d+/);
  });

  it.fails("does not crash on a non-array manifest build", async () => {
    const dir = manifestWith({ build: "npm ci" });
    const results = await byId(dir);
    expect(results.get("manifest")?.status).toBe("fail");
  });
});

describe("host-contract drift: manifest (packages/server/src/server/plugins/manifest.ts)", () => {
  it.fails("accepts $comment, which `paseo plugin init` writes and Paseo's non-strict schema ignores", async () => {
    expect((await byId(manifestWith({ $comment: "scaffold note" }))).get("manifest")?.status).toBe("pass");
  });

  it.fails("rejects ids outside /^[a-z][a-z0-9-]*$/ (protocol plugin-config.ts PluginIdSchema)", async () => {
    expect((await byId(manifestWith({ id: "Hello_Plugin" }))).get("manifest")?.status).toBe("fail");
  });

  it.fails("rejects an invalid requirements.paseo range and unknown requirement keys (strict schema)", async () => {
    expect((await byId(manifestWith({ requirements: { paseo: "0.11+" } }))).get("manifest")?.status).toBe("fail");
    expect((await byId(manifestWith({ requirements: { paseo: ">=0.11.2", pasoe: ">=1" } }))).get("manifest")?.status).toBe("fail");
  });
});

describe("host-contract drift: compiler boundaries (compiler.ts directoryTarget)", () => {
  it.fails("fails a module outside client/, server/ and shared/, which Paseo's compiler rejects", async () => {
    const dir = variant({
      "lib/label.ts": 'export const LABEL = "Hello";\n',
      "index.client.tsx": [/^/, 'import { LABEL } from "./lib/label";\n'],
    });
    const results = await byId(dir);
    expect([...results.values()].some((result) => result.status === "fail")).toBe(true);
  });
});

describe("host-contract drift: client registration (packages/app/src/plugins/evaluate.ts)", () => {
  it("fails contributions the app rejects: bad id, bad context, missing callback, duplicate id, no cleanup", async () => {
    const dir = variant({
      "index.client.tsx": `import type { PluginClientContext } from "@getpaseo/plugin/client";
import { HelloPanel } from "./client/hello-panel";
export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: "hello_panel", title: "Hello", icon: "Hand", context: "workspaces" as never, Component: HelloPanel });
  client.addCommandCenterItem({ id: "open-hello", title: "Open", icon: "Hand", context: "workspace", onSelect: undefined as never });
  client.addCommandCenterItem({ id: "open-hello", title: "Again", icon: "Hand", context: "workspace", onSelect: () => {} });
}
`,
    });
    expect((await byId(dir)).get("client-eval")?.status).toBe("fail");
  });
});

describe("registry precheck robustness and drift", () => {
  it.fails("reports a non-array media field instead of crashing", () => {
    expect(() => precheck(manifestWith({ media: "assets/screenshot.png" }))).not.toThrow();
  });

  it.fails("reports an unparsable media URL instead of crashing", () => {
    expect(() => precheck(manifestWith({ media: ["https://"] }))).not.toThrow();
  });

  it.fails("allows a video first: the card uses the first image entry (registry PROTOCOL.md 'even when a video comes first')", () => {
    const findings = precheck(manifestWith({ media: ["https://example.com/demo.mp4", "assets/screenshot.png"] }));
    expect(findings.filter((finding) => finding.area === "media" && finding.level === "error")).toEqual([]);
  });
});

describe("tool discovery", () => {
  it.fails("does not silently fall back when an explicit --paseo path does not exist", () => {
    expect(findPaseoBin("/nonexistent/paseo")).toBeNull();
  });
});

describe("daemon lifecycle", () => {
  it.fails("removes the temp home of a stale (dead) daemon record before starting a new one", async () => {
    const state = scratch("ppd-review-state-");
    const previous = process.env.PPD_STATE_DIR;
    process.env.PPD_STATE_DIR = state;
    try {
      const staleHome = scratch("ppd-stale-home-");
      writeFileSync(join(staleHome, HOME_MARKER), "test\n");
      mkdirSync(join(state, "daemons"), { recursive: true });
      writeFileSync(
        join(state, "daemons/stale.json"),
        JSON.stringify({ name: "stale", pid: 999_999, port: 7899, home: staleHome, url: "http://127.0.0.1:7899", paseoBin: "x", paseoVersion: null, webDist: null, startedAt: "" }),
      );
      const fakePaseo = join(scratch("ppd-fake-bin-"), "paseo");
      writeFileSync(fakePaseo, "#!/bin/sh\n[ \"$1\" = --version ] && echo 0.0.0 && exit 0\nexit 1\n");
      chmodSync(fakePaseo, 0o755);
      await daemonUp({ name: "stale", paseo: fakePaseo, port: 7898, timeoutMs: 3000, log: () => {} }).catch(() => {});
      expect(existsSync(staleHome)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PPD_STATE_DIR;
      else process.env.PPD_STATE_DIR = previous;
    }
  });
});

describe("plugins in a subdirectory of a repository", () => {
  function repoWithSubPlugin(): { repo: string; plugin: string } {
    const repo = scratch("ppd-mono-");
    const plugin = join(repo, "plugins/hello");
    cpSync(EXAMPLE, plugin, { recursive: true });
    const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", "https://github.com/acme/monorepo.git");
    git("add", ".");
    git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "init");
    return { repo, plugin };
  }

  it.fails("installs --git from the repository root with a plugin path (a file:// URL of a subdirectory is not a Git repo)", () => {
    const { plugin } = repoWithSubPlugin();
    expect(installSource(plugin, true)).not.toMatch(/\/plugins\/hello$/);
  });

  it.fails("prefills the submission form with the folder URL, not the repository root", () => {
    const { plugin } = repoWithSubPlugin();
    const result = ppd(["registry", "submit", plugin]);
    expect(decodeURIComponent(result.stdout)).toMatch(/github\.com\/acme\/monorepo\/tree\/[^/\s]+\/plugins\/hello/);
  });
});

describe("release", () => {
  it.fails("checks the remote before committing and tagging, so a failed push leaves no local release behind", () => {
    const repo = join(scratch("ppd-rel-"), "plugin");
    cpSync(EXAMPLE, repo, { recursive: true });
    const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "feat: init");
    ppd(["release", "patch", "--yes", "--dir", repo]);
    expect(git("tag").stdout.trim()).toBe("");
  });
});

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { submissionUrl } from "../src/registry/index.ts";
import { branchName, githubSlug, matchRecord, normalizeRemote, registryUpdate, updatedRecord, type GitRecord } from "../src/registry/update.ts";
import { scratch } from "./helpers.ts";

const record: GitRecord = {
  id: "acme/viewer",
  artifact: { kind: "git", remote: "https://github.com/acme/paseo-viewer.git", commit: "a".repeat(40), tag: "v0.3.0" },
  repository: { url: "https://github.com/acme/paseo-viewer" },
  categories: ["extras"],
  submittedAt: "2026-10-16T11:52:38Z",
  publishedAt: "2026-10-16T12:04:40Z",
  reviewedAt: "2026-10-16T12:04:40Z",
};

describe("record helpers", () => {
  it("normalizes GitHub remotes", () => {
    expect(normalizeRemote("git@github.com:Acme/paseo-viewer.git")).toBe("https://github.com/acme/paseo-viewer");
    expect(normalizeRemote("https://github.com/acme/paseo-viewer/")).toBe("https://github.com/acme/paseo-viewer");
    expect(githubSlug("git@github.com:acme/plugins.git")).toBe("acme/plugins");
  });

  it("changes only the pin and keeps dates for the reviewer", () => {
    const next = updatedRecord(record, "b".repeat(40), "v0.4.0");
    expect(next.artifact).toEqual({ ...record.artifact, commit: "b".repeat(40), tag: "v0.4.0" });
    expect(next.reviewedAt).toBe(record.reviewedAt);
    expect(Object.keys(next)).toEqual(Object.keys(record));
  });

  it("matches records by remote or id", () => {
    const records = [{ path: "plugins/acme/viewer.json", record }];
    expect(matchRecord(records, "git@github.com:acme/paseo-viewer.git")?.path).toBe("plugins/acme/viewer.json");
    expect(matchRecord(records, "x", "acme/viewer")).not.toBeNull();
    expect(matchRecord(records, "https://github.com/other/x")).toBeNull();
  });

  it("tells plugins of one monorepo apart by pluginPath", () => {
    const record = (id: string, pluginPath?: string): { path: string; record: GitRecord } => ({
      path: `plugins/${id}.json`,
      record: { id, artifact: { kind: "git", remote: "https://github.com/acme/mono", commit: "c", ...(pluginPath ? { pluginPath } : {}) } },
    });
    const records = [record("acme/root"), record("acme/a", "plugins/a"), record("acme/b", "plugins/b")];
    expect(matchRecord(records, "https://github.com/acme/mono", undefined, "plugins/b")?.record.id).toBe("acme/b");
    expect(matchRecord(records, "https://github.com/acme/mono")?.record.id).toBe("acme/root");
    expect(branchName("acme/viewer", "v0.4.0")).toBe("update-acme-viewer-v0.4.0");
  });

  it("builds a prefilled web form URL instead of filing an issue", () => {
    const url = new URL(submissionUrl("PDF and Office viewer", "https://github.com/acme/paseo-viewer"));
    expect(url.pathname).toBe("/getpaseo/plugins/issues/new");
    expect(url.searchParams.get("template")).toBe("submit-plugin.yml");
    expect(url.searchParams.get("source")).toBe("https://github.com/acme/paseo-viewer");
  });
});

describe("registryUpdate against local repos", () => {
  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }
  function setup() {
    const root = scratch("ppd-reg-");
    const identity = ["-c", "user.email=t@example.com", "-c", "user.name=T"];
    // Plugin repo with a pushed tag.
    const pluginRemote = join(root, "plugin-remote.git");
    git(root, "init", "-q", "--bare", pluginRemote);
    const plugin = join(root, "plugin");
    mkdirSync(plugin);
    git(plugin, "init", "-q", "-b", "main");
    writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "viewer", version: "0.4.0" }));
    writeFileSync(join(plugin, "paseo-plugin.json"), JSON.stringify({ id: "viewer", requirements: { paseo: ">=0.11.0" } }));
    git(plugin, "add", ".");
    git(plugin, ...identity, "commit", "-qm", "init");
    git(plugin, ...identity, "tag", "-a", "v0.4.0", "-m", "v0.4.0");
    git(plugin, "remote", "add", "origin", pluginRemote);
    git(plugin, "push", "-q", "origin", "main", "v0.4.0");
    const commit = git(plugin, "rev-parse", "HEAD");
    // Upstream registry and a fork checkout. The fake validator fails if TMPDIR is not canonical.
    const upstream = join(root, "registry-upstream.git");
    const seed = join(root, "seed");
    mkdirSync(join(seed, "plugins/acme"), { recursive: true });
    mkdirSync(join(seed, "scripts"));
    writeFileSync(join(seed, "plugins/acme/viewer.json"), `${JSON.stringify({ ...record, artifact: { ...record.artifact, remote: pluginRemote } }, null, 2)}\n`);
    writeFileSync(
      join(seed, "scripts/validate.ts"),
      `import { realpathSync } from "node:fs";\nconst t = process.env.TMPDIR ?? "";\nif (realpathSync(t) !== t) { console.error("TMPDIR not canonical: " + t); process.exit(1); }\nconsole.log("validated " + process.argv.slice(2).join(" "));\n`,
    );
    git(seed, "init", "-q", "-b", "main");
    git(seed, "add", ".");
    git(seed, ...identity, "commit", "-qm", "seed");
    git(root, "clone", "-q", "--bare", seed, upstream);
    const forkRemote = join(root, "fork.git");
    git(root, "clone", "-q", "--bare", seed, forkRemote);
    const fork = join(root, "fork");
    git(root, "clone", "-q", forkRemote, fork);
    git(fork, "remote", "add", "upstream", upstream);
    git(fork, "config", "user.email", "t@example.com");
    git(fork, "config", "user.name", "T");
    return { plugin, fork, forkRemote, commit };
  }

  it("prepares a validated record-edit branch, restores the checkout and does not push without --yes", () => {
    const { plugin, fork, forkRemote, commit } = setup();
    const lines: string[] = [];
    const plan = registryUpdate(plugin, { registryDir: fork, log: (line) => lines.push(line) });
    expect(plan?.branch).toBe("update-acme-viewer-v0.4.0");
    expect(git(fork, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    const updated = JSON.parse(git(fork, "show", `${plan!.branch}:plugins/acme/viewer.json`));
    expect(updated.artifact).toMatchObject({ commit, tag: "v0.4.0" });
    expect(updated.reviewedAt).toBe(record.reviewedAt);
    expect(git(fork, "log", "-1", "--format=%s", plan!.branch)).toBe("Update acme/viewer to v0.4.0");
    expect(lines.join("\n")).toMatch(/validator: validated --online --changed --base upstream\/main/);
    expect(lines.join("\n")).toMatch(/not posted/);
    expect(git(forkRemote, "branch", "--list", plan!.branch)).toBe("");
    expect(readFileSync(join(fork, "plugins/acme/viewer.json"), "utf8")).toContain("a".repeat(40));
  });

  it("reruns cleanly when the branch already holds the update (after a failed push)", () => {
    const { plugin, fork } = setup();
    const first = registryUpdate(plugin, { registryDir: fork, log: () => {} });
    const lines: string[] = [];
    const again = registryUpdate(plugin, { registryDir: fork, log: (line) => lines.push(line) });
    expect(again?.branch).toBe(first?.branch);
    expect(lines.join("\n")).toMatch(/already has this update; reusing it/);
    expect(git(fork, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("refuses an unpushed tag", () => {
    const { plugin, fork } = setup();
    git(plugin, "-c", "user.email=t@example.com", "-c", "user.name=T", "tag", "v0.5.0");
    expect(() => registryUpdate(plugin, { registryDir: fork, tag: "v0.5.0", log: () => {} })).toThrow(/not on origin yet/);
  });
});

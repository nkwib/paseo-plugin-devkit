import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changelogEntries, changelogSection, insertChangelogSection, nextVersion, releaseSteps } from "../src/release.ts";
import { CLI, scratch } from "./helpers.ts";

describe("versions", () => {
  it("bumps and validates", () => {
    expect(nextVersion("0.4.0", "patch")).toBe("0.4.1");
    expect(nextVersion("0.4.1", "minor")).toBe("0.5.0");
    expect(nextVersion("0.4.1", "major")).toBe("1.0.0");
    expect(nextVersion("0.4.1", "v0.6.0")).toBe("0.6.0");
    expect(() => nextVersion("0.4.1", "0.4.1")).toThrow(/not greater/);
    expect(() => nextVersion("0.4.1", "soon")).toThrow(/not a version/);
  });
});

describe("changelog", () => {
  const log = "# Changelog\n\n## 0.4.0 (2026-10-17)\n\n- Find in PDFs.\n\n## [0.3.0]\n\n- CSV.\n";

  it("extracts a section in any common heading style", () => {
    expect(changelogSection(log, "0.4.0")).toBe("- Find in PDFs.");
    expect(changelogSection(log, "0.3.0")).toBe("- CSV.");
    expect(changelogSection(log, "0.5.0")).toBeNull();
  });

  it("inserts a new section above the latest one", () => {
    const next = insertChangelogSection(log, "0.5.0", "2026-10-18", ["feat: thumbnails"]);
    expect(next.indexOf("## 0.5.0")).toBeLessThan(next.indexOf("## 0.4.0"));
    expect(changelogSection(next, "0.5.0")).toBe("- feat: thumbnails");
    expect(insertChangelogSection("", "0.1.0", "2026-10-18", [])).toContain("# Changelog\n\n## 0.1.0 (2026-10-18)\n\n- No notable changes.");
  });

  it("drops merges and release commits", () => {
    expect(changelogEntries(["feat: a", "Merge pull request #1", "chore: release 0.4.0", "fix: b"])).toEqual(["feat: a", "fix: b"]);
  });
});

describe("release plan", () => {
  it("bumps, commits, tags, pushes and creates the release in order", () => {
    const argv = releaseSteps("0.5.0", "main", "/x/notes.md", true).flatMap((step) => (step.argv ? [step.argv.slice(0, 3).join(" ")] : []));
    expect(argv).toEqual(["npm version 0.5.0", "git commit -am", "git tag -a", "git push origin", "git push origin", "gh release create"]);
  });
});

describe("ppd release CLI", () => {
  function repo(): string {
    const dir = scratch("ppd-rel-");
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.2.3" }, null, 2));
    git("add", ".");
    git("commit", "-qm", "feat: first");
    const remote = scratch("ppd-rel-remote-");
    spawnSync("git", ["init", "-q", "--bare", remote]);
    git("remote", "add", "origin", remote);
    git("push", "-q", "origin", "main");
    return dir;
  }
  const ppd = (dir: string, ...args: string[]) => spawnSync(process.execPath, [CLI, "release", ...args, "--dir", dir], { encoding: "utf8", input: "" });

  it("refuses to run without a TTY unless --yes", () => {
    const result = ppd(repo(), "patch");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/run it yourself in a terminal/);
  });

  it("--dry-run prints the commands and changes nothing", () => {
    const dir = repo();
    const result = ppd(dir, "minor", "--dry-run");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/release 1\.2\.3 -> 1\.3\.0 on main/);
    expect(result.stdout).toContain("gh release create v1.3.0");
    expect(result.stdout).toContain("- feat: first");
    expect(result.stdout).toMatch(/dry run: nothing changed/);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version).toBe("1.2.3");
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout).toBe("");
    expect(spawnSync("git", ["tag"], { cwd: dir, encoding: "utf8" }).stdout).toBe("");
  });

  it("resumes a release whose commit and tag exist but were never pushed, instead of bumping again", () => {
    const dir = repo();
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.2.4" }, null, 2));
    git("commit", "-qam", "chore: release 1.2.4");
    git("tag", "-a", "v1.2.4", "-m", "v1.2.4");
    const result = ppd(dir, "patch", "--dry-run");
    expect(result.stdout).toMatch(/resuming release v1\.2\.4/);
    expect(result.stdout).toContain("git push origin v1.2.4");
    expect(result.stdout).not.toMatch(/git commit|1\.2\.5/);
    expect(result.stdout).toContain("--notes-file '<notes>'");
  });

  it("is blocked when origin cannot take the push, before committing or tagging", () => {
    const dir = repo();
    spawnSync("git", ["remote", "set-url", "origin", join(dir, "missing.git")], { cwd: dir });
    const result = ppd(dir, "patch", "--yes");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/cannot push main to origin/);
    expect(spawnSync("git", ["tag"], { cwd: dir, encoding: "utf8" }).stdout).toBe("");
  });

  it("is blocked on a dirty tree", () => {
    const dir = repo();
    writeFileSync(join(dir, "dirty.txt"), "x");
    const result = ppd(dir, "patch", "--dry-run");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/working tree is not clean/);
  });
});

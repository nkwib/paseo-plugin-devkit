// `ppd registry update`: a Git plugin release becomes a record-edit PR in a fork of getpaseo/plugins.
// The registry never scans Git repositories for new tags, so each Git release needs this PR (or a new submission).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run, runOrThrow } from "../proc.ts";
import { compareVersions } from "../release.ts";
import { gitLocation } from "../git.ts";
import { canonicalPath } from "../safety.ts";

export const UPSTREAM_REGISTRY = "getpaseo/plugins";

export interface GitRecord {
  id: string;
  artifact: { kind: "git"; remote: string; commit: string; tag?: string; pluginPath?: string };
  [key: string]: unknown;
}

/** https://github.com/o/r, git@github.com:o/r.git and https://github.com/o/r.git all compare equal. */
export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function githubSlug(remote: string): string | null {
  const match = /github\.com\/([^/]+)\/([^/]+)$/.exec(normalizeRemote(remote));
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The record for an id, or for this remote and plugin path ("" for the repository root; monorepos list several). */
export function matchRecord(records: { path: string; record: GitRecord }[], remote: string, id?: string, pluginPath = ""): { path: string; record: GitRecord } | null {
  const clean = (path: string | undefined) => (path ?? "").replace(/^\.\/?/, "").replace(/\/+$/, "");
  return (
    records.find(({ record }) =>
      id
        ? record.id === id
        : record.artifact?.kind === "git" && normalizeRemote(record.artifact.remote) === normalizeRemote(remote) && clean(record.artifact.pluginPath) === clean(pluginPath),
    ) ?? null
  );
}

/** Records as they are on a ref (the registry's main), read with git so the fork's checkout is untouched. */
export function recordsAtRef(registryDir: string, ref: string, log: (line: string) => void = () => {}): { path: string; record: GitRecord }[] {
  const files = runOrThrow("git", ["ls-tree", "-r", "--name-only", ref, "plugins/"], { cwd: registryDir })
    .split("\n")
    .filter((file) => /^plugins\/[^/]+\/[^/]+\.json$/.test(file));
  return files.flatMap((file) => {
    try {
      return [{ path: file, record: JSON.parse(runOrThrow("git", ["show", `${ref}:${file}`], { cwd: registryDir })) as GitRecord }];
    } catch (error) {
      log(`warning: skipped ${file} on ${ref}: ${(error as Error).message.split("\n")[0]}`);
      return [];
    }
  });
}

/** The record with a new pin. Dates and review fields stay: the reviewer and bot own them. */
export function updatedRecord(record: GitRecord, commit: string, tag: string | undefined): GitRecord {
  const artifact = { ...record.artifact, commit };
  if (tag) artifact.tag = tag;
  else delete artifact.tag;
  return { ...record, artifact };
}

export function branchName(id: string, tag: string): string {
  return `update-${id.replace(/[^\w.-]+/g, "-")}-${tag}`.replace(/-+/g, "-");
}

/** A temp dir whose path is already canonical. The registry validator compares a realpath to a mkdtemp path, which fails under macOS /var. */
export function canonicalTmpdir(): string {
  return mkdtempSync(join(canonicalPath(tmpdir()), "ppd-registry-"));
}

export interface UpdateOptions {
  registryDir: string;
  tag?: string;
  id?: string;
  yes?: boolean;
  log?: (line: string) => void;
}

export interface UpdatePlan {
  id: string;
  recordPath: string;
  from: { commit: string; tag?: string };
  to: { commit: string; tag: string };
  branch: string;
  base: string;
}

export function registryUpdate(pluginDir: string, options: UpdateOptions): UpdatePlan | null {
  const log = options.log ?? console.log;
  const dir = resolve(pluginDir);
  const registry = resolve(options.registryDir);
  if (!existsSync(join(registry, "scripts/validate.ts"))) throw new Error(`${registry} is not a getpaseo/plugins checkout`);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string };
  const tag = options.tag ?? `v${pkg.version}`;
  const remote = runOrThrow("git", ["remote", "get-url", "origin"], { cwd: dir }).trim();
  const commit = runOrThrow("git", ["rev-parse", `refs/tags/${tag}^{commit}`], { cwd: dir }).trim();
  const remoteTags = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { cwd: dir }).stdout;
  if (!remoteTags.includes(commit)) throw new Error(`tag ${tag} (${commit.slice(0, 7)}) is not on origin yet: push it first (git push origin ${tag})`);

  if (run("git", ["status", "--porcelain"], { cwd: registry }).stdout.trim()) throw new Error(`${registry} has uncommitted changes`);
  const hasUpstream = run("git", ["remote", "get-url", "upstream"], { cwd: registry }).status === 0;
  const baseRemote = hasUpstream ? "upstream" : "origin";
  runOrThrow("git", ["fetch", "--quiet", baseRemote, "main"], { cwd: registry });
  const base = `${baseRemote}/main`;
  if (!hasUpstream) log(`note: no upstream remote in ${registry}; basing on origin/main (add: git remote add upstream https://github.com/${UPSTREAM_REGISTRY}.git)`);

  const pluginPath = gitLocation(dir)?.path ?? "";
  const found = matchRecord(recordsAtRef(registry, base, log), remote, options.id, pluginPath);
  if (!found) throw new Error(`no registry record for ${remote}${pluginPath ? ` path ${pluginPath}` : ""}${options.id ? ` (${options.id})` : ""} on ${base}: new listings go through the web form (ppd registry submit)`);
  const { record } = found;
  const path = join(registry, found.path);
  const plan: UpdatePlan = {
    id: record.id,
    recordPath: path,
    from: { commit: record.artifact.commit, ...(record.artifact.tag ? { tag: record.artifact.tag } : {}) },
    to: { commit, tag },
    branch: branchName(record.id, tag),
    base,
  };
  if (record.artifact.commit === commit) {
    log(`${record.id} is already pinned to ${tag} (${commit.slice(0, 7)})`);
    return null;
  }

  const branch = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: registry }).stdout.trim();
  const head = runOrThrow("git", ["rev-parse", "HEAD"], { cwd: registry }).trim();
  const restore = () => run("git", branch ? ["switch", "--quiet", branch] : ["switch", "--quiet", "--detach", head], { cwd: registry });
  try {
    runOrThrow("git", ["switch", "--quiet", "-c", plan.branch, base], { cwd: registry });
    writeFileSync(path, `${JSON.stringify(updatedRecord(record, commit, tag), null, 2)}\n`);
    runOrThrow("git", ["add", path], { cwd: registry });
    runOrThrow("git", ["commit", "--quiet", "-m", `Update ${record.id} to ${tag}`], { cwd: registry });
    log(`branch ${plan.branch}: ${record.id} ${plan.from.tag ?? plan.from.commit.slice(0, 7)} -> ${tag} (${commit.slice(0, 7)})`);
    const semver = /^v?\d+\.\d+\.\d+/;
    if (plan.from.tag && semver.test(plan.from.tag) && semver.test(tag) && compareVersions(tag.replace(/^v/, ""), plan.from.tag.replace(/^v/, "")) < 0) {
      log(`warning: ${tag} is older than the listed ${plan.from.tag}`);
    }

    const tmp = canonicalTmpdir();
    try {
      log(`running the registry validator (TMPDIR=${tmp})`);
      const validation = run(process.execPath, ["scripts/validate.ts", "--online", "--changed", "--base", base], {
        cwd: registry,
        env: { ...process.env, TMPDIR: tmp },
        timeout: 600_000,
      });
      const output = `${validation.stdout}${validation.stderr}`.trim();
      if (validation.status !== 0) {
        throw new Error(`registry validator failed; branch ${plan.branch} kept for inspection:\n${output}`);
      }
      log(output ? `validator: ${output.split("\n").slice(-3).join(" | ")}` : "validator passed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    const forkRemote = runOrThrow("git", ["remote", "get-url", "origin"], { cwd: registry }).trim();
    const forkOwner = githubSlug(forkRemote)?.split("/")[0];
    const body = `Updates ${record.id} to ${tag} (${commit}).\n\nRelease: ${normalizeRemote(remote)}/releases/tag/${tag}`;
    const push = ["git", "-C", registry, "push", "-u", "origin", plan.branch];
    const pr = ["gh", "pr", "create", "--repo", UPSTREAM_REGISTRY, "--head", `${forkOwner}:${plan.branch}`, "--base", "main", "--title", `Update ${record.id} to ${tag}`, "--body", body];
    if (!options.yes) {
      log("\nnot posted. To open the PR (or rerun with --yes):");
      log(`  ${shellJoin(push)}`);
      log(`  ${shellJoin(pr)}`);
    } else {
      runOrThrow(push[0]!, push.slice(1), { stdio: "inherit" });
      const url = runOrThrow(pr[0]!, pr.slice(1)).trim();
      log(`opened ${url}\nverify: the PR shows in ${UPSTREAM_REGISTRY} and the reviewer picks it up (runs every 30 min)`);
    }
    return plan;
  } finally {
    restore();
  }
}

export function shellJoin(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)).join(" ");
}

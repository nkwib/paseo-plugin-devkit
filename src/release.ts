// `ppd release`: bump, changelog section, release commit, tag, push, GitHub release. Meant to be run by a
// person: without a TTY it refuses unless --yes is passed, and --dry-run only prints the commands.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { run, runOrThrow } from "./proc.ts";
import { precheck } from "./registry/precheck.ts";
import { shellJoin } from "./registry/update.ts";
import { UsageError } from "./usage.ts";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;

export function nextVersion(current: string, request: string): string {
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`package.json version ${current} is not semver`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "major") return `${major + 1}.0.0`;
  const explicit = request.replace(/^v/, "");
  if (!SEMVER.test(explicit)) throw new Error(`not a version or bump: ${request}`);
  if (compareVersions(explicit, current) <= 0) throw new Error(`${explicit} is not greater than ${current}`);
  return explicit;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index++) if (pa[index] !== pb[index]) return pa[index]! - pb[index]!;
  return 0;
}

const headingFor = (version: string) => new RegExp(`^##\\s+\\[?v?${version.replaceAll(".", "\\.")}\\]?(\\s|$)`, "m");

/** The body under `## X.Y.Z` (also `## [X.Y.Z]`, `## vX.Y.Z`), up to the next level-2 heading. */
export function changelogSection(changelog: string, version: string): string | null {
  const match = headingFor(version).exec(changelog);
  if (!match) return null;
  const rest = changelog.slice(match.index + match[0].length);
  const body = rest.slice(rest.indexOf("\n") + 1);
  const next = body.search(/^##\s/m);
  return (next === -1 ? body : body.slice(0, next)).trim();
}

/** Inserts a new section above the first existing `## ` heading (or at the end). */
export function insertChangelogSection(changelog: string, version: string, date: string, entries: string[]): string {
  const section = `## ${version} (${date})\n\n${entries.map((entry) => `- ${entry}`).join("\n") || "- No notable changes."}\n\n`;
  if (!changelog.trim()) return `# Changelog\n\n${section}`;
  const first = changelog.search(/^##\s/m);
  return first === -1 ? `${changelog.trimEnd()}\n\n${section}` : `${changelog.slice(0, first)}${section}${changelog.slice(first)}`;
}

/** Commit subjects worth a changelog line: drops merges and release commits. */
export function changelogEntries(subjects: string[]): string[] {
  return subjects.filter((subject) => subject && !/^Merge /.test(subject) && !/^chore(\(.*\))?: release/.test(subject));
}

export interface ReleaseStep {
  description: string;
  argv?: string[];
  /** A step the CLI performs itself instead of running a command. */
  kind?: "changelog" | "await-npm";
}

/**
 * Polls npm until the version is served. The tag push triggers the publish, so for an npm package the GitHub
 * release must wait for it: a release page that names a version npm never served is the failure this prevents.
 */
export async function awaitNpmVersion(
  name: string,
  version: string,
  options: { timeoutMs?: number; intervalMs?: number; now?: () => number; view?: (spec: string) => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const intervalMs = options.intervalMs ?? 10_000;
  const now = options.now ?? Date.now;
  const view = options.view ?? ((spec: string) => run("npm", ["view", spec, "version", "--prefer-online"], { timeout: 60_000 }).status === 0);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    if (view(`${name}@${version}`)) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

export function releaseSteps(version: string, branch: string, notesFile: string, hasLock: boolean, npmName: string | null = null): ReleaseStep[] {
  const tag = `v${version}`;
  return [
    { description: `set package.json${hasLock ? " and package-lock.json" : ""} version to ${version}`, argv: ["npm", "version", version, "--no-git-tag-version", "--allow-same-version"] },
    { description: "write the changelog section (if missing)", kind: "changelog" },
    { description: "release commit", argv: ["git", "commit", "-am", `chore: release ${version}`] },
    { description: "annotated tag", argv: ["git", "tag", "-a", tag, "-m", tag] },
    { description: "push the branch", argv: ["git", "push", "origin", branch] },
    { description: "push the tag", argv: ["git", "push", "origin", tag] },
    // For a Git-installed plugin the GitHub release is the artifact, so it is created straight away. For an npm
    // package the tag triggers the publish, and the release waits for npm to serve it.
    ...(npmName ? [{ description: `wait for npm to serve ${npmName}@${version}`, kind: "await-npm" as const }] : []),
    { description: "GitHub release", argv: ["gh", "release", "create", tag, "--title", tag, "--notes-file", notesFile, "--verify-tag"] },
  ];
}

/** HEAD is `chore: release <version>` and tag v<version> points at it: the commit and tag steps already ran. */
export function isReleaseCommit(dir: string, version: string): boolean {
  const subject = run("git", ["log", "-1", "--format=%s"], { cwd: dir }).stdout.trim();
  if (subject !== `chore: release ${version}`) return false;
  const tagged = run("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}^{commit}`], { cwd: dir }).stdout.trim();
  return tagged !== "" && tagged === run("git", ["rev-parse", "HEAD"], { cwd: dir }).stdout.trim();
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export async function releaseCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { "dry-run": { type: "boolean" }, yes: { type: "boolean" }, dir: { type: "string" }, "skip-precheck": { type: "boolean" } },
    strict: true,
  });
  const request = positionals[0];
  if (!request) throw new UsageError("ppd release <patch|minor|major|X.Y.Z> [--dry-run] [--yes]");
  const dir = resolve(values.dir ?? ".");
  const dry = Boolean(values["dry-run"]);
  if (!dry && !values.yes && !process.stdin.isTTY) {
    throw new Error("ppd release pushes a tag and publishes a GitHub release: run it yourself in a terminal, or pass --yes. Use --dry-run to see the commands.");
  }
  const git = (gitArgs: string[]) => runOrThrow("git", gitArgs, { cwd: dir }).trim();
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string; name?: string; private?: boolean };
  // A private package is never published, so its release waits for nothing.
  const npmName = pkg.private === true || !pkg.name ? null : pkg.name;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const hasOrigin = run("git", ["remote", "get-url", "origin"], { cwd: dir }).status === 0;
  const onOrigin = (name: string) => hasOrigin && run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${name}`], { cwd: dir, timeout: 60_000 }).status === 0;
  // A previous run that got as far as the commit and tag: finish it instead of releasing the next version. The push
  // may have failed, or the push landed and the GitHub release did not (an npm publish that never served the
  // version stops the run there). Both resume; the push steps are no-ops the second time.
  const released = (name: string) => run("gh", ["release", "view", name], { cwd: dir, timeout: 60_000 }).status === 0;
  const started = isReleaseCommit(dir, pkg.version);
  const resume = started && !(onOrigin(`v${pkg.version}`) && released(`v${pkg.version}`));
  const version = resume ? pkg.version : nextVersion(pkg.version, request);
  const tag = `v${version}`;

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!resume) {
    if (git(["status", "--porcelain"])) blockers.push("working tree is not clean");
    if (run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: dir }).status === 0) blockers.push(`tag ${tag} already exists`);
    if (!values["skip-precheck"] && existsSync(join(dir, "paseo-plugin.json"))) {
      for (const finding of precheck(dir).filter((f) => f.level === "error" && f.area !== "git")) blockers.push(`registry precheck: ${finding.message}`);
    }
  }
  if (branch === "HEAD") blockers.push("detached HEAD: check out the release branch");
  // Remote preflight before anything is committed or tagged, so a push failure leaves no local release behind.
  if (!hasOrigin) blockers.push("no origin remote: nothing to push the release to");
  else if (branch !== "HEAD") {
    if (!resume && onOrigin(tag)) blockers.push(`tag ${tag} already exists on origin`);
    const probe = run("git", ["push", "--dry-run", "--porcelain", "origin", `HEAD:refs/heads/${branch}`], { cwd: dir, timeout: 120_000 });
    if (probe.status !== 0) blockers.push(`cannot push ${branch} to origin: ${(probe.stderr || probe.stdout).trim().split("\n").slice(-2).join(" ")}`);
  }
  if (run("gh", ["auth", "status"], { timeout: 30_000 }).status !== 0) warnings.push("gh is missing or not logged in: the GitHub release step will fail (rerun ppd release after `gh auth login`; it resumes)");

  const changelogPath = join(dir, "CHANGELOG.md");
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  let section = changelogSection(changelog, version);
  let newChangelog: string | null = null;
  if (!section && !resume) {
    const lastTag = run("git", ["describe", "--tags", "--abbrev=0"], { cwd: dir }).stdout.trim();
    const subjects = git(["log", "--format=%s", ...(lastTag ? [`${lastTag}..HEAD`] : [])]).split("\n");
    const entries = changelogEntries(subjects);
    newChangelog = insertChangelogSection(changelog, version, new Date().toISOString().slice(0, 10), entries);
    section = changelogSection(newChangelog, version) ?? "";
  }
  section ??= "";

  const work = mkdtempSync(join(tmpdir(), "ppd-release-"));
  const notesFile = join(work, "notes.md");
  writeFileSync(notesFile, `${section}\n`);
  const all = releaseSteps(version, branch, notesFile, existsSync(join(dir, "package-lock.json")), npmName);
  const steps = resume ? all.filter((step) => step.argv?.[0] === "gh" || step.argv?.[1] === "push" || step.kind === "await-npm") : all;
  const shown = (argv: string[]) => shellJoin(argv.map((arg) => (arg === notesFile ? "<notes>" : arg)));
  try {
    if (resume) console.log(`resuming release ${tag}: the release commit and tag exist, ${onOrigin(tag) ? "but no GitHub release does" : "but not on origin"} (ignoring "${request}")`);
    else console.log(`release ${pkg.version} -> ${version} on ${branch}${newChangelog ? " (changelog section generated from commits; edit CHANGELOG.md first to curate it)" : ""}`);
    console.log(`notes:\n${section.split("\n").map((line) => `  ${line}`).join("\n")}\n`);
    for (const step of steps) console.log(`  ${step.argv ? shown(step.argv) : `# ${step.description}`}`);
    for (const warning of warnings) console.log(`\nwarning: ${warning}`);
    if (blockers.length) {
      console.log(`\nblocked:\n  ${blockers.join("\n  ")}`);
      return 1;
    }
    if (dry) {
      console.log("\ndry run: nothing changed");
      return 0;
    }
    if (!values.yes && !(await confirm(`\nrelease ${tag}? [y/N] `))) return 1;
    for (const step of steps) {
      if (step.argv) {
        if (step.argv[0] === "gh" && run("gh", ["release", "view", tag], { cwd: dir, timeout: 60_000 }).status === 0) {
          console.log(`GitHub release ${tag} already exists`);
          continue;
        }
        console.log(`$ ${shown(step.argv)}`);
        runOrThrow(step.argv[0]!, step.argv.slice(1), { cwd: dir, stdio: "inherit" });
      } else if (step.kind === "await-npm" && npmName) {
        console.log(`# ${step.description}`);
        if (!(await awaitNpmVersion(npmName, version))) {
          const kept = join(tmpdir(), `ppd-release-${tag}-notes.md`);
          writeFileSync(kept, `${section}\n`);
          console.log(`\nnpm has not served ${npmName}@${version}. The tag is pushed, so the release workflow owns the publish: check it.`);
          console.log(`No GitHub release was created, because it would name a version nobody can install.`);
          console.log(`Once npm serves it:\n  ${shellJoin(["gh", "release", "create", tag, "--title", tag, "--notes-file", kept, "--verify-tag"])}`);
          return 1;
        }
      } else if (step.kind === "changelog" && newChangelog !== null) {
        writeFileSync(changelogPath, newChangelog);
        if (!changelog) runOrThrow("git", ["add", "CHANGELOG.md"], { cwd: dir });
      }
    }
    console.log(`\nreleased ${tag}. For a Git-sourced registry listing: ppd registry update --registry <fork> --tag ${tag}`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

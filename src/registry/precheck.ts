// `ppd registry precheck`: what the registry reviewer would bounce, checked before submitting or updating.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import { run } from "../proc.ts";
import { isInside } from "../safety.ts";
import { lintOverview } from "./overview.ts";

export interface PrecheckFinding {
  level: "error" | "warn" | "ok";
  area: string;
  message: string;
}

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
export const VIDEO_EXTENSIONS = [".mp4", ".webm"];

interface Manifest {
  id?: string;
  name?: string;
  description?: string;
  icon?: string;
  media?: string[];
  build?: unknown;
  requirements?: { paseo?: string };
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  files?: string[];
  dependencies?: Record<string, string>;
  repository?: string | { url?: string };
}

/** Media rules from the publishing guide: package-relative paths or public HTTPS URLs with a known extension. */
export function mediaFindings(pluginDir: string, manifest: Manifest, pkg: PackageJson | null): PrecheckFinding[] {
  const findings: PrecheckFinding[] = [];
  const media = manifest.media ?? [];
  media.forEach((entry, index) => {
    const isUrl = /^[a-z]+:\/\//i.test(entry);
    const ext = extname(isUrl ? new URL(entry).pathname : entry).toLowerCase();
    const allowed = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
    if (!allowed.includes(ext)) findings.push({ level: "error", area: "media", message: `${entry}: extension must be one of ${allowed.join(" ")} (SVG and extensionless URLs are rejected)` });
    if (index === 0 && !IMAGE_EXTENSIONS.includes(ext)) findings.push({ level: "error", area: "media", message: `${entry}: the first media entry is the card thumbnail and must be an image` });
    if (isUrl) {
      if (!entry.startsWith("https://")) findings.push({ level: "error", area: "media", message: `${entry}: media URLs must be HTTPS` });
      return;
    }
    findings.push(...localAssetFindings(pluginDir, entry, "media", pkg));
  });
  if (manifest.icon) {
    if (extname(manifest.icon).toLowerCase() !== ".png") findings.push({ level: "error", area: "icon", message: `${manifest.icon}: the listing icon must be a PNG` });
    findings.push(...localAssetFindings(pluginDir, manifest.icon, "icon", pkg));
  }
  return findings;
}

function localAssetFindings(pluginDir: string, entry: string, area: string, pkg: PackageJson | null): PrecheckFinding[] {
  const findings: PrecheckFinding[] = [];
  if (entry.includes("\\") || isAbsolute(entry)) findings.push({ level: "error", area, message: `${entry}: use a relative path with forward slashes` });
  const full = resolve(pluginDir, entry);
  if (!isInside(full, pluginDir)) findings.push({ level: "error", area, message: `${entry}: path leaves the plugin directory` });
  else if (!existsSync(full) || !statSync(full).isFile()) findings.push({ level: "error", area, message: `${entry}: file does not exist` });
  if (pkg?.files && !pkg.files.some((pattern) => coversPath(pattern, entry))) {
    findings.push({ level: "warn", area, message: `${entry}: not in package.json files, so an npm release would not ship it` });
  }
  return findings;
}

function coversPath(pattern: string, path: string): boolean {
  const clean = normalize(pattern).replace(/\/+$/, "").replace(/^\.\//, "");
  return path === clean || path.startsWith(`${clean}/`);
}

/** `build` must be argv arrays. Runtime deps need `npm ci` against a committed lock, without dev deps or scripts. */
export function buildFindings(manifest: Manifest, pkg: PackageJson | null, pluginDir: string): PrecheckFinding[] {
  const findings: PrecheckFinding[] = [];
  const deps = Object.keys(pkg?.dependencies ?? {});
  const build = manifest.build;
  if (build !== undefined) {
    if (!Array.isArray(build) || !build.every((argv) => Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === "string" && part.length > 0))) {
      findings.push({ level: "error", area: "build", message: "build must be a list of non-empty argv arrays; shell strings are rejected" });
      return findings;
    }
    for (const argv of build as string[][]) {
      const command = argv.join(" ");
      if (argv[0] === "npm" && (argv[1] === "install" || argv[1] === "i")) findings.push({ level: "warn", area: "build", message: `${command}: use npm ci so the committed lock decides the tree` });
      if (argv[0] === "npm" && argv[1] === "ci") {
        if (!argv.includes("--omit=dev")) findings.push({ level: "warn", area: "build", message: `${command}: add --omit=dev so dev tools are not installed on users' machines` });
        if (!argv.includes("--ignore-scripts")) findings.push({ level: "warn", area: "build", message: `${command}: add --ignore-scripts to suppress dependency lifecycle scripts` });
      }
      if (/^(sh|bash|zsh)$/.test(argv[0]!) || argv.includes("-c")) findings.push({ level: "warn", area: "build", message: `${command}: shell commands are hard to review; reviewers expect locked, inspectable inputs` });
    }
  }
  if (deps.length) {
    const lock = ["package-lock.json", "npm-shrinkwrap.json"].find((file) => existsSync(join(pluginDir, file)));
    if (!lock) findings.push({ level: "error", area: "lockfile", message: `runtime dependencies (${deps.join(", ")}) without package-lock.json or npm-shrinkwrap.json` });
    else findings.push(...lockSyncFindings(join(pluginDir, lock), pkg!));
    if (!build) findings.push({ level: "error", area: "build", message: 'runtime dependencies but no build: Git installs need ["npm", "ci", "--omit=dev", "--ignore-scripts"]' });
  }
  return findings;
}

function lockSyncFindings(lockPath: string, pkg: PackageJson): PrecheckFinding[] {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages?: Record<string, { dependencies?: Record<string, string>; version?: string }> };
    const root = lock.packages?.[""];
    if (!root) return [{ level: "warn", area: "lockfile", message: "lockfile has no packages[\"\"] entry (lockfileVersion < 2?)" }];
    const drift = Object.entries(pkg.dependencies ?? {}).filter(([name, range]) => root.dependencies?.[name] !== range);
    if (drift.length) return [{ level: "error", area: "lockfile", message: `lockfile out of sync for ${drift.map(([name]) => name).join(", ")}: run npm install --package-lock-only --ignore-scripts` }];
    if (pkg.version && root.version && root.version !== pkg.version) return [{ level: "warn", area: "lockfile", message: `lockfile version ${root.version} differs from package.json ${pkg.version}` }];
    return [{ level: "ok", area: "lockfile", message: `${lockPath.split("/").pop()} matches package.json dependencies` }];
  } catch (error) {
    return [{ level: "error", area: "lockfile", message: `cannot parse lockfile: ${(error as Error).message}` }];
  }
}

export function gitFindings(pluginDir: string): PrecheckFinding[] {
  const inside = run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: pluginDir });
  if (inside.status !== 0) return [{ level: "warn", area: "git", message: "not a Git repository: Git submissions pin a commit" }];
  const findings: PrecheckFinding[] = [];
  const listing = ["paseo-plugin.json", "OVERVIEW.md", "package.json", "package-lock.json"].filter((file) => existsSync(join(pluginDir, file)));
  const tracked = new Set(run("git", ["ls-files", ...listing], { cwd: pluginDir }).stdout.split("\n").filter(Boolean).map((file) => file.split("/").pop()));
  for (const file of listing) if (!tracked.has(file)) findings.push({ level: "error", area: "git", message: `${file} is not committed, so the pinned commit will not contain it` });
  const dirty = run("git", ["status", "--porcelain", "--", ...listing], { cwd: pluginDir }).stdout.trim();
  if (dirty) findings.push({ level: "warn", area: "git", message: `uncommitted listing changes:\n${dirty}` });
  const remote = run("git", ["remote", "get-url", "origin"], { cwd: pluginDir }).stdout.trim();
  if (!remote) findings.push({ level: "warn", area: "git", message: "no origin remote" });
  else if (!/github\.com[:/]/.test(remote)) findings.push({ level: "warn", area: "git", message: `origin ${remote} is not GitHub: the public registry accepts public GitHub repositories and npm packages` });
  return findings;
}

export function precheck(pluginDir: string): PrecheckFinding[] {
  const dir = resolve(pluginDir);
  const findings: PrecheckFinding[] = [];
  const manifestPath = join(dir, "paseo-plugin.json");
  if (!existsSync(manifestPath)) return [{ level: "error", area: "manifest", message: "no paseo-plugin.json" }];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const pkg = existsSync(join(dir, "package.json")) ? (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson) : null;

  if (!manifest.description && !pkg?.description) findings.push({ level: "warn", area: "manifest", message: "no one-sentence description (manifest description for Git, package.json description for npm)" });
  if (!manifest.name) findings.push({ level: "warn", area: "manifest", message: "no display name: the listing humanizes the id" });
  if (!manifest.media?.length) findings.push({ level: "warn", area: "media", message: "no media: visual plugins need at least one screenshot of the current interface" });
  if (!manifest.requirements?.paseo) findings.push({ level: "error", area: "manifest", message: "requirements.paseo is missing" });
  findings.push(...mediaFindings(dir, manifest, pkg));
  findings.push(...buildFindings(manifest, pkg, dir));

  const overviewPath = join(dir, "OVERVIEW.md");
  if (!existsSync(overviewPath)) {
    findings.push({ level: "warn", area: "overview", message: "no OVERVIEW.md: the reviewer writes a registry overview from your README" });
  } else {
    const lint = lintOverview(readFileSync(overviewPath, "utf8"));
    for (const finding of lint) findings.push({ level: finding.level, area: "overview", message: `OVERVIEW.md:${finding.line}: ${finding.message}` });
    if (!lint.length) findings.push({ level: "ok", area: "overview", message: "OVERVIEW.md passes the listing lint" });
    if (pkg?.files && !pkg.files.includes("OVERVIEW.md")) findings.push({ level: "warn", area: "overview", message: "OVERVIEW.md is not in package.json files (needed for npm releases)" });
  }
  findings.push(...gitFindings(dir));
  return findings;
}

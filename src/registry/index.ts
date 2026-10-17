// `ppd registry precheck|update|submit`.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { run } from "../proc.ts";
import { UsageError } from "../usage.ts";
import { precheck, type PrecheckFinding } from "./precheck.ts";
import { normalizeRemote, registryUpdate, UPSTREAM_REGISTRY } from "./update.ts";

/** New listings go through the issue form: only the form applies the `submission` label that starts intake. */
export function submissionUrl(title: string, source: string): string {
  const params = new URLSearchParams({ template: "submit-plugin.yml", title, source });
  return `https://github.com/${UPSTREAM_REGISTRY}/issues/new?${params.toString()}`;
}

export function formatFindings(findings: PrecheckFinding[]): string {
  const mark = { error: "FAIL", warn: "WARN", ok: "OK  " } as const;
  const lines = findings.map((finding) => `${mark[finding.level]}  ${finding.area.padEnd(9)} ${finding.message.replace(/\n/g, "\n                ")}`);
  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.filter((finding) => finding.level === "warn").length;
  lines.push("", errors ? `${errors} error(s), ${warnings} warning(s): fix errors before submitting` : `no errors, ${warnings} warning(s)`);
  return lines.join("\n");
}

export async function registryCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      registry: { type: "string" },
      tag: { type: "string" },
      id: { type: "string" },
      yes: { type: "boolean" },
    },
    strict: true,
  });
  const dir = resolve(positionals[0] ?? ".");
  if (sub === "precheck") {
    const findings = precheck(dir);
    console.log(values.json ? JSON.stringify(findings, null, 2) : formatFindings(findings));
    return findings.some((finding) => finding.level === "error") ? 1 : 0;
  }
  if (sub === "update") {
    if (!values.registry) throw new UsageError("ppd registry update [dir] --registry <your getpaseo/plugins fork checkout>");
    const findings = precheck(dir).filter((finding) => finding.level === "error");
    if (findings.length) {
      console.log(formatFindings(findings));
      return 1;
    }
    registryUpdate(dir, { registryDir: values.registry, tag: values.tag, id: values.id, yes: values.yes });
    return 0;
  }
  if (sub === "submit") {
    const manifest = JSON.parse(readFileSync(join(dir, "paseo-plugin.json"), "utf8")) as { name?: string; id?: string };
    const remote = run("git", ["remote", "get-url", "origin"], { cwd: dir }).stdout.trim();
    const source = remote ? normalizeRemote(remote).replace(/^https:\/\/github\.com/, "https://github.com") : "";
    const errors = precheck(dir).filter((finding) => finding.level === "error");
    if (errors.length) console.log(`${formatFindings(errors)}\n`);
    console.log(`Open this form in a browser and submit it yourself (do not use gh issue create: CLI issues miss the submission label):
  ${submissionUrl(manifest.name ?? manifest.id ?? "", source)}
Then tick categories, add interface image URLs to the description if you have no media, and submit.
Afterwards verify: the issue has the "submission" label and the bot opens a review PR (intake retries every 30 minutes).`);
    if (!existsSync(join(dir, "OVERVIEW.md"))) console.log("Tip: ship OVERVIEW.md beside paseo-plugin.json to own your listing page.");
    return errors.length ? 1 : 0;
  }
  throw new UsageError("ppd registry precheck|update|submit [dir]");
}

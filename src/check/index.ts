// `ppd check`: the host-contract checks a plugin otherwise finds out about on a phone or after install.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundleRequires, disallowedClientRequires, disallowedServerRequires, evaluateClientBundle, evaluateServerBundle, formatKb, sizeReport } from "./bundle.ts";
import { compileLikePaseo, compileWithPaseo, findEntries, findPaseoSource, PASEO_SOURCE_MISSING } from "./compile.ts";
import { classSyntaxErrors, findHermes, hermesParse, hermesSmoke } from "./hermes.ts";
import { boundaryFindings, dependencyFindings, externalPackages, pluginFiles, typesNodeFinding } from "./imports.ts";
import { lucideIconNames, staticIconNames } from "./lucide.ts";

export type Status = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  status: Status;
  message: string;
  details?: string[];
}

export interface CheckOptions {
  paseoSource?: string | null;
  maxClientBytes?: number;
  maxServerBytes?: number;
}

export const DEFAULT_MAX_CLIENT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_SERVER_BYTES = 32 * 1024 * 1024;

interface Manifest {
  id?: string;
  requirements?: { paseo?: string };
  build?: string[][];
  icon?: string;
  [key: string]: unknown;
}

export async function runChecks(pluginDir: string, options: CheckOptions = {}): Promise<CheckResult[]> {
  const dir = resolve(pluginDir);
  const results: CheckResult[] = [];
  const add = (id: string, status: Status, message: string, details?: string[]) =>
    results.push({ id, status, message, ...(details?.length ? { details } : {}) });

  const manifestPath = resolve(dir, "paseo-plugin.json");
  if (!existsSync(manifestPath)) {
    add("manifest", "fail", "no paseo-plugin.json");
    return results;
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    add("manifest", "fail", `paseo-plugin.json is not valid JSON: ${(error as Error).message}`);
    return results;
  }
  const entries = findEntries(dir);
  const manifestProblems = [
    !manifest.id && "missing id",
    !manifest.requirements?.paseo && "missing requirements.paseo",
    !entries.client && !entries.server && "no index.client.tsx/ts or index.server.ts/tsx",
    ...Object.keys(manifest).filter((key) => key.startsWith("$")).map((key) => `editor key ${key} in manifest`),
    manifest.icon && !existsSync(resolve(dir, manifest.icon)) && `icon ${manifest.icon} does not exist`,
  ].filter((problem): problem is string => Boolean(problem));
  add("manifest", manifestProblems.length ? "fail" : "pass", manifestProblems.length ? manifestProblems.join("; ") : `${manifest.id}, requires paseo ${manifest.requirements?.paseo}`);
  if (!entries.client && !entries.server) return results;

  const files = pluginFiles(dir);
  const boundaries = boundaryFindings(dir, files);
  add("imports", boundaries.some((f) => f.level === "error") ? "fail" : "pass", boundaries.length ? `${boundaries.length} boundary problem(s)` : "client, server and shared boundaries hold", boundaries.map((f) => f.message));

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  if (existsSync(resolve(dir, "package.json"))) pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  const imported = externalPackages([...files.client, ...files.server, ...files.shared]);
  const deps = dependencyFindings(imported, pkg, manifest.build);
  const typesNode = typesNodeFinding(pkg);
  if (typesNode) deps.push(typesNode);
  add(
    "dependencies",
    deps.some((f) => f.level === "error") ? "fail" : deps.length ? "warn" : "pass",
    deps.length ? `${deps.length} finding(s)` : imported.size ? `runtime packages declared: ${[...imported].join(", ")}` : "no runtime packages",
    deps.map((f) => f.message),
  );

  const paseoSource = options.paseoSource === undefined ? findPaseoSource() : options.paseoSource;
  let clientBundle: string | null = null;
  let serverBundle: string | null = null;
  let realHandlers: string[] | null = null;
  let realEvalError: string | null = null;
  let realEvalMs: number | null = null;
  if (paseoSource) {
    const real = await compileWithPaseo(dir, paseoSource);
    if (real.error && real.stage === "evaluate") {
      add("paseo-compile", "pass", "Paseo's compilePlugin accepted the plugin");
      clientBundle = real.clientBundle;
      serverBundle = real.serverBundle;
      realEvalError = real.error;
    } else if (real.error) {
      add("paseo-compile", "fail", `Paseo ${real.stage} failed: ${real.error.split("\n")[0]}`, real.error.split("\n").slice(1, 20));
    } else {
      add("paseo-compile", "pass", `Paseo's compilePlugin accepted the plugin (${relative(process.cwd(), paseoSource) || paseoSource})`);
      clientBundle = real.clientBundle;
      serverBundle = real.serverBundle;
      realHandlers = real.handlers;
      realEvalMs = real.evalMs;
    }
  } else {
    add("paseo-compile", "skip", `real compiler not run: ${PASEO_SOURCE_MISSING}`);
  }
  if (!paseoSource || (!clientBundle && !serverBundle)) {
    try {
      if (entries.client) clientBundle = await compileLikePaseo(entries.client, "client");
      if (entries.server) serverBundle = await compileLikePaseo(entries.server, "server");
      add("approx-compile", "pass", "esbuild with Paseo's build options compiled both entries");
    } catch (error) {
      add("approx-compile", "fail", `esbuild compile failed: ${(error as Error).message.split("\n")[0]}`);
      return results;
    }
  }

  if (clientBundle) {
    const bad = disallowedClientRequires(clientBundle);
    add("client-requires", bad.length ? "fail" : "pass", bad.length ? `client bundle requires modules the app does not provide: ${bad.join(", ")}` : `client requires only host modules (${bundleRequires(clientBundle).join(", ") || "none"})`);
  }
  if (serverBundle) {
    const bad = disallowedServerRequires(serverBundle);
    add("server-requires", bad.length ? "fail" : "pass", bad.length ? `server bundle leaves bare requires that resolve from Paseo's install, not the plugin: ${bad.join(", ")}` : "server requires only host modules and Node built-ins");
  }

  if (serverBundle) {
    if (realEvalError) {
      add("server-eval", "fail", `Paseo's evaluator failed on the server bundle: ${realEvalError}`);
    } else if (realHandlers) {
      add("server-eval", "pass", `Paseo's evaluator ran the contribution in ${realEvalMs} ms; RPCs: ${realHandlers.join(", ") || "none"}`);
    } else {
      try {
        const evaluation = evaluateServerBundle(serverBundle, dir);
        add("server-eval", "pass", `evaluated in ${evaluation.evalMs} ms; RPCs: ${[...evaluation.handlers.keys()].join(", ") || "none"}`);
        realEvalMs = evaluation.evalMs;
      } catch (error) {
        add("server-eval", "fail", `server bundle failed to evaluate: ${(error as Error).message}`);
      }
    }
  }

  const contributionIcons = new Set<string>();
  if (clientBundle) {
    try {
      const evaluation = await evaluateClientBundle(clientBundle, dir);
      evaluation.icons.forEach((icon) => contributionIcons.add(icon));
      const summary = `contributions: ${evaluation.contributions.map((c) => c.method).join(", ") || "none"}`;
      if (evaluation.setupError) add("client-eval", "warn", `contribution threw under stub host modules (may be a stub limit): ${evaluation.setupError}`, [summary]);
      else add("client-eval", "pass", summary);
    } catch (error) {
      add("client-eval", "fail", `client bundle failed to evaluate: ${(error as Error).message}`);
    }

    const classErrors = await classSyntaxErrors(clientBundle);
    add("hermes-class", classErrors.length ? "fail" : "pass", classErrors.length ? `client bundle contains class syntax, which crashes plugin loading on Hermes (getpaseo/paseo#5783)` : "no class syntax in the client bundle", classErrors.slice(0, 5));

    const hermes = findHermes(dir);
    if (hermes.hermesc) {
      const parsed = hermesParse(hermes.hermesc, clientBundle);
      add("hermes-parse", parsed.ok ? "pass" : "fail", parsed.ok ? "hermesc compiles the client bundle" : "hermesc rejected the client bundle", parsed.ok ? [] : parsed.output.split("\n").slice(0, 10));
    } else {
      add("hermes-parse", "skip", "hermesc not found (install react-native as a devDependency, or set HERMESC)");
    }
    if (hermes.hermes) {
      const smoke = hermesSmoke(hermes.hermes, clientBundle);
      smoke.icons.forEach((icon) => contributionIcons.add(icon));
      if (smoke.ok) add("hermes-vm", "pass", `Hermes VM evaluated the bundle and ran the contribution (${smoke.registered.join(", ") || "no registrations"})`);
      else if (smoke.stage === "contribute") add("hermes-vm", "warn", `contribution threw under stub host modules on Hermes: ${smoke.error}`);
      else add("hermes-vm", "fail", `Hermes VM failed at ${smoke.stage}: ${smoke.error?.split("\n")[0]}`);
    } else {
      add("hermes-vm", "skip", "Hermes VM not found (react-native ships it for macOS; or set HERMES)");
    }
  }

  const lucide = lucideIconNames([paseoSource, dir]);
  const staticIcons = new Set(files.client.flatMap((file) => staticIconNames(readFileSync(file, "utf8"))));
  if (!lucide) {
    add("lucide-icons", "skip", `no lucide-react-native type list (${PASEO_SOURCE_MISSING}); icons seen: ${[...new Set([...contributionIcons, ...staticIcons])].join(", ") || "none"}`);
  } else {
    const unknownContrib = [...contributionIcons].filter((icon) => !lucide.names.has(icon));
    const unknownStatic = [...staticIcons].filter((icon) => !contributionIcons.has(icon) && !lucide.names.has(icon));
    if (unknownContrib.length) add("lucide-icons", "fail", `unknown Lucide names in contributions (Paseo throws at registration): ${unknownContrib.join(", ")}`);
    else if (unknownStatic.length) add("lucide-icons", "warn", `unknown Lucide names in client source (Icon renders nothing): ${unknownStatic.join(", ")}`);
    else add("lucide-icons", "pass", `${new Set([...contributionIcons, ...staticIcons]).size} icon name(s) valid against ${lucide.names.size} Lucide icons`);
  }

  const maxClient = options.maxClientBytes ?? DEFAULT_MAX_CLIENT_BYTES;
  const maxServer = options.maxServerBytes ?? DEFAULT_MAX_SERVER_BYTES;
  const sizes: string[] = [];
  let over = false;
  if (clientBundle) {
    const size = sizeReport(clientBundle);
    sizes.push(`client ${formatKb(size.bytes)} (${formatKb(size.gzipBytes)} gzip), budget ${formatKb(maxClient)}`);
    over ||= size.bytes > maxClient;
  }
  if (serverBundle) {
    const size = sizeReport(serverBundle);
    sizes.push(`server ${formatKb(size.bytes)} (${formatKb(size.gzipBytes)} gzip), eval ${realEvalMs ?? "?"} ms, budget ${formatKb(maxServer)}`);
    over ||= size.bytes > maxServer;
  }
  add("bundle-size", over ? "warn" : "pass", sizes.join("; "));
  return results;
}

const MARK: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

export function formatResults(results: CheckResult[]): string {
  const lines = results.flatMap((result) => [
    `${MARK[result.status]}  ${result.id.padEnd(16)} ${result.message}`,
    ...(result.details ?? []).map((detail) => `      ${detail}`),
  ]);
  const count = (status: Status) => results.filter((result) => result.status === status).length;
  lines.push("", `${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed, ${count("skip")} skipped`);
  return lines.join("\n");
}

export async function checkCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "paseo-source": { type: "string" },
      "max-client-kb": { type: "string" },
      "max-server-kb": { type: "string" },
    },
    strict: true,
  });
  const explicit = values["paseo-source"];
  const paseoSource = explicit ? findPaseoSource(explicit) : findPaseoSource();
  if (explicit && !paseoSource) throw new Error(`${explicit} is not a usable Paseo checkout (needs ${"packages/server/src/server/plugins/compiler.ts"} and node_modules)`);
  const results = await runChecks(positionals[0] ?? ".", {
    paseoSource,
    ...(values["max-client-kb"] ? { maxClientBytes: Number(values["max-client-kb"]) * 1024 } : {}),
    ...(values["max-server-kb"] ? { maxServerBytes: Number(values["max-server-kb"]) * 1024 } : {}),
  });
  console.log(values.json ? JSON.stringify(results, null, 2) : formatResults(results));
  return results.some((result) => result.status === "fail") ? 1 : 0;
}

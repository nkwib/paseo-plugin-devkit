// `ppd check`: the host-contract checks a plugin otherwise finds out about on a phone or after install.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundleRequires, disallowedClientRequires, disallowedServerRequires, formatKb, sizeReport } from "./bundle.ts";
import { compileApprox, CompileError, compileLikePaseo, compileWithHost, describeHost, findEntries, findPaseoApp, findPaseoHost, findPaseoSource, PASEO_COMPILER, PASEO_SOURCE_MISSING } from "./compile.ts";
import { classSyntaxErrors, findHermes, hermesParse, hermesSmoke } from "./hermes.ts";
import { boundaryFindings, dependencyFindings, externalPackages, pluginFiles, typesNodeFinding } from "./imports.ts";
import { cleanupWarning, DEFAULT_EVAL_TIMEOUT_MS, evaluateIsolated } from "./isolate.ts";
import { hostIconNames, staticIconNames } from "./lucide.ts";
import { manifestFindings } from "./manifest.ts";
import { UsageError } from "../usage.ts";

export type Status = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  status: Status;
  message: string;
  details?: string[];
}

export interface CheckOptions {
  /** A Paseo checkout for the real compiler. Undefined: PASEO_SOURCE. Null: do not use one. */
  paseoSource?: string | null;
  /** A Paseo.app for the real compiler and icon list. Undefined: discover (PASEO_APP, PATH, /Applications). Null: do not use one. */
  paseoApp?: string | null;
  maxClientBytes?: number;
  maxServerBytes?: number;
  /** Kill plugin evaluation after this long (default 30 s, Paseo's plugin init timeout). */
  evalTimeoutMs?: number;
  /** Kill Paseo's compile step after this long (default 120 s). */
  compileTimeoutMs?: number;
}

export const DEFAULT_MAX_CLIENT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_SERVER_BYTES = 32 * 1024 * 1024;

interface Manifest {
  id?: unknown;
  requirements?: { paseo?: unknown };
  build?: unknown;
  icon?: unknown;
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
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("not a JSON object");
  } catch (error) {
    add("manifest", "fail", `paseo-plugin.json is not valid JSON: ${(error as Error).message}`);
    return results;
  }
  const entries = findEntries(dir);
  const vendored = manifestFindings(manifest);
  const manifestProblems = [
    ...vendored.errors,
    !entries.client && !entries.server && "no index.client.tsx/ts or index.server.ts/tsx",
    typeof manifest.icon === "string" && !existsSync(resolve(dir, manifest.icon)) && `icon ${manifest.icon} does not exist`,
  ].filter((problem): problem is string => Boolean(problem));
  if (manifestProblems.length) add("manifest", "fail", manifestProblems.join("; "), vendored.warnings);
  else if (vendored.warnings.length) add("manifest", "warn", vendored.warnings.join("; "));
  else add("manifest", "pass", `${manifest.id}, requires paseo ${manifest.requirements?.paseo}`);
  if (!entries.client && !entries.server) return results;

  const files = pluginFiles(dir);
  const boundaries = boundaryFindings(dir, files);
  add("imports", boundaries.some((f) => f.level === "error") ? "fail" : "pass", boundaries.length ? `${boundaries.length} boundary problem(s)` : "client, server and shared boundaries hold", boundaries.map((f) => f.message));

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  if (existsSync(resolve(dir, "package.json"))) pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  const imported = externalPackages([...files.client, ...files.server, ...files.shared]);
  const deps = dependencyFindings(imported, pkg, Array.isArray(manifest.build) ? manifest.build : undefined);
  const typesNode = typesNodeFinding(pkg);
  if (typesNode) deps.push(typesNode);
  add(
    "dependencies",
    deps.some((f) => f.level === "error") ? "fail" : deps.length ? "warn" : "pass",
    deps.length ? `${deps.length} finding(s)` : imported.size ? `runtime packages declared: ${[...imported].join(", ")}` : "no runtime packages",
    deps.map((f) => f.message),
  );

  const host = findPaseoHost(options);
  let clientBundle: string | null = null;
  let serverBundle: string | null = null;
  let realHandlers: string[] | null = null;
  let realEvalError: string | null = null;
  let realEvalMs: number | null = null;
  let realCleanupWarning: string | null = null;
  if (host) {
    const real = await compileWithHost(dir, host, options.compileTimeoutMs);
    if (real.error && real.stage === "evaluate") {
      add("paseo-compile", "pass", `compilePlugin of the ${describeHost(host)} accepted the plugin`);
      clientBundle = real.clientBundle;
      serverBundle = real.serverBundle;
      realEvalError = real.error;
    } else if (real.error) {
      add("paseo-compile", "fail", `Paseo ${real.stage} failed: ${real.error.split("\n")[0]}`, real.error.split("\n").slice(1, 20));
    } else {
      add("paseo-compile", "pass", `compilePlugin of the ${describeHost(host)} accepted the plugin`);
      clientBundle = real.clientBundle;
      serverBundle = real.serverBundle;
      realHandlers = real.handlers;
      realEvalMs = real.evalMs;
      if (real.serverBundle && real.returnsCleanup === false) realEvalError = "Plugin contribution must return a cleanup function";
      realCleanupWarning = cleanupWarning(real);
    }
  } else {
    const why = options.paseoApp === null ? "the real compiler was turned off (--approx)" : PASEO_SOURCE_MISSING;
    add("paseo-compile", "skip", `APPROXIMATION: ${why}. Compile, evaluation and icon checks below use an esbuild replica and rules vendored from Paseo, not the host itself`);
  }
  if (!host || (!clientBundle && !serverBundle)) {
    try {
      if (entries.client) clientBundle = (await compileApprox(entries.client, "client")).bundle;
      if (entries.server) serverBundle = (await compileApprox(entries.server, "server")).bundle;
      add("approx-compile", "pass", "approximation: esbuild with Paseo 0.11's build options compiled both entries");
    } catch (error) {
      const locations = error instanceof CompileError ? error.locations : [(error as Error).message];
      add("approx-compile", "fail", `esbuild compile failed: ${locations[0]}`, locations.slice(1, 20));
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

  const lucide = hostIconNames(host, dir);
  const evalTimeoutMs = options.evalTimeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const [serverOutcome, clientOutcome] = await Promise.all([
    serverBundle && !realEvalError && !realHandlers ? evaluateIsolated("server", serverBundle, dir, { timeoutMs: evalTimeoutMs }) : null,
    clientBundle ? evaluateIsolated("client", clientBundle, dir, { timeoutMs: evalTimeoutMs, icons: lucide?.names ?? null }) : null,
  ]);
  if (serverBundle) {
    if (realEvalError) {
      add("server-eval", "fail", `Paseo's evaluator failed on the server bundle: ${realEvalError}`);
    } else if (realHandlers) {
      const summary = `Paseo's evaluator ran the contribution in ${realEvalMs} ms; RPCs: ${realHandlers.join(", ") || "none"}`;
      if (realCleanupWarning) add("server-eval", "warn", realCleanupWarning, [summary]);
      else add("server-eval", "pass", summary);
    } else if (serverOutcome && !serverOutcome.ok) {
      add("server-eval", "fail", `server bundle failed to evaluate: ${serverOutcome.error}`);
    } else if (serverOutcome?.ok) {
      const result = serverOutcome.result;
      if ("error" in result) add("server-eval", "fail", `server bundle failed to evaluate: ${result.error}`);
      else if (result.target === "server") {
        realEvalMs = result.evalMs;
        if (result.contractErrors.length) add("server-eval", "fail", `Paseo would stop this plugin: ${result.contractErrors.join("; ")}`);
        else {
          const summary = `evaluated in ${result.evalMs} ms; RPCs: ${result.handlers.join(", ") || "none"}`;
          const leak = cleanupWarning(result);
          if (leak) add("server-eval", "warn", leak, [summary]);
          else add("server-eval", "pass", summary);
        }
      }
    }
  }

  const contributionIcons = new Set<string>();
  if (clientBundle) {
    if (clientOutcome && !clientOutcome.ok) {
      add("client-eval", "fail", `client bundle failed to evaluate: ${clientOutcome.error}`);
    } else if (clientOutcome?.ok) {
      const result = clientOutcome.result;
      if ("error" in result) add("client-eval", "fail", `client bundle failed to evaluate: ${result.error}`);
      else if (result.target === "client") {
        result.icons.forEach((icon) => contributionIcons.add(icon));
        const summary = `contributions: ${result.contributions.join(", ") || "none"}`;
        if (result.contractErrors.length) add("client-eval", "fail", "the app would reject this plugin client and show none of its UI", [...result.contractErrors, summary]);
        else if (result.setupError) add("client-eval", "warn", `contribution threw under stub host modules (may be a stub limit): ${result.setupError}`, [summary]);
        else if (cleanupWarning(result)) add("client-eval", "warn", cleanupWarning(result)!, [summary]);
        else add("client-eval", "pass", summary);
      }
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

  const staticIcons = new Set(files.client.flatMap((file) => staticIconNames(readFileSync(file, "utf8"))));
  if (!lucide) {
    add("lucide-icons", "skip", `no Lucide list (${PASEO_SOURCE_MISSING}, and the plugin has no lucide-react-native); icons seen: ${[...new Set([...contributionIcons, ...staticIcons])].join(", ") || "none"}`);
  } else {
    const against = lucide.exact ? `${lucide.names.size} Lucide icons of the ${host ? describeHost(host) : "host"}` : `${lucide.names.size} icons of the plugin's own lucide-react-native (approximation: may differ from the app's version)`;
    const unknownContrib = [...contributionIcons].filter((icon) => !lucide.names.has(icon));
    const unknownStatic = [...staticIcons].filter((icon) => !contributionIcons.has(icon) && !lucide.names.has(icon));
    if (unknownContrib.length) add("lucide-icons", "fail", `unknown Lucide names in contributions (Paseo throws at registration): ${unknownContrib.join(", ")}`);
    else if (unknownStatic.length) add("lucide-icons", "warn", `unknown Lucide names in client source (Icon renders nothing): ${unknownStatic.join(", ")}`);
    else add("lucide-icons", "pass", `${new Set([...contributionIcons, ...staticIcons]).size} icon name(s) valid against ${against}`);
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
      "paseo-app": { type: "string" },
      approx: { type: "boolean" },
      "max-client-kb": { type: "string" },
      "max-server-kb": { type: "string" },
    },
    strict: true,
  });
  const explicit = values["paseo-source"];
  const paseoSource = values.approx ? null : explicit ? findPaseoSource(explicit) : findPaseoSource();
  if (explicit && !paseoSource) throw new Error(`${explicit} is not a usable Paseo checkout: it needs ${PASEO_COMPILER} and node_modules (run npm ci there)`);
  const app = values["paseo-app"];
  if (app && !findPaseoApp(app)) throw new Error(`${app} is not a Paseo desktop app: it needs Contents/Resources/app.asar and the Paseo Helper`);
  const paseoApp = values.approx ? null : (app ?? undefined);
  const kib = (flag: "max-client-kb" | "max-server-kb") => {
    const value = values[flag];
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) throw new UsageError(`--${flag} must be a whole number of KiB, got ${value}`);
    return Number(value) * 1024;
  };
  const maxClientBytes = kib("max-client-kb");
  const maxServerBytes = kib("max-server-kb");
  const results = await runChecks(positionals[0] ?? ".", {
    paseoSource,
    ...(paseoApp !== undefined ? { paseoApp } : {}),
    ...(maxClientBytes !== undefined ? { maxClientBytes } : {}),
    ...(maxServerBytes !== undefined ? { maxServerBytes } : {}),
  });
  console.log(values.json ? JSON.stringify(results, null, 2) : formatResults(results));
  return results.some((result) => result.status === "fail") ? 1 : 0;
}

export interface ClientCheck {
  /** Registration errors: the app would evaluate none of the plugin's client. */
  errors: string[];
  /** Warnings worth showing (stub limits, cleanup leaks), or a reason the check could not run. */
  notes: string[];
  /** Where the Lucide names came from, or null when icons were not checked. */
  iconSource: string | null;
}

/**
 * The client half of `ppd check` for commands that install: compiles the client entry and evaluates it against
 * the app's registration rules and Lucide names. Null when the plugin has no client.
 */
export async function checkClient(pluginDir: string, options: CheckOptions = {}): Promise<ClientCheck | null> {
  const dir = resolve(pluginDir);
  const entry = findEntries(dir).client;
  if (!entry) return null;
  const lucide = hostIconNames(findPaseoHost(options), dir);
  let bundle: string;
  try {
    bundle = await compileLikePaseo(entry, "client");
  } catch (error) {
    return { errors: [`client compile failed: ${(error as Error).message}`], notes: [], iconSource: null };
  }
  const outcome = await evaluateIsolated("client", bundle, dir, { timeoutMs: options.evalTimeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS, icons: lucide?.names ?? null });
  const iconSource = lucide?.source ?? null;
  if (!outcome.ok) return { errors: [outcome.error], notes: [], iconSource };
  const result = outcome.result;
  if ("error" in result) return { errors: [result.error], notes: [], iconSource };
  if (result.target !== "client") return null;
  const notes = [
    ...(result.setupError ? [`contribution threw under stub host modules (may be a stub limit): ${result.setupError}`] : []),
    ...(cleanupWarning(result) ? [cleanupWarning(result)!] : []),
    ...(iconSource ? [] : ["icon names not checked: no Lucide list found"]),
  ];
  return { errors: result.contractErrors, notes, iconSource };
}

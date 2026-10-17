// Evaluating compiled plugin bundles outside Paseo: what they require, what they register, and how big they are.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { CLIENT_HOST_MODULES, isHostClientModule, isHostServerModule, isNodeBuiltin, SDK_CLIENT_ONLY } from "./host.ts";

/** Runtime `require("x")` calls left in a compiled bundle, i.e. modules the host must supply. */
export function bundleRequires(bundle: string): string[] {
  const found = new Set<string>();
  for (const match of bundle.matchAll(/\brequire\(\s*(["'])([^"'\n]+)\1\s*\)/g)) found.add(match[2]!);
  return [...found].sort();
}

export function disallowedClientRequires(bundle: string): string[] {
  return bundleRequires(bundle).filter((name) => !isHostClientModule(name));
}

/** Server bundles may require host modules and Node built-ins; other bare names resolve from Paseo's install. */
export function disallowedServerRequires(bundle: string): string[] {
  return bundleRequires(bundle).filter((name) => !isHostServerModule(name) && !isNodeBuiltin(name));
}

/**
 * A callable, chainable stand-in for host APIs. Any property or call returns another stub, and awaiting a stub
 * resolves to a non-thenable stub, so `await client.paseo.workspaces.list()` and `.then(...)` both work.
 */
export function chainStub(): unknown {
  return makeStub(true);
}

function makeStub(thenable: boolean): unknown {
  const target = function () {};
  let settled: unknown;
  const proxy: unknown = new Proxy(target, {
    get: (_, key) => {
      if (key === "then") {
        if (!thenable) return undefined;
        return (resolve?: (value: unknown) => unknown) => {
          settled ??= makeStub(false);
          return Promise.resolve(resolve ? resolve(settled) : settled);
        };
      }
      if (key === "__esModule") return true;
      if (typeof key === "string" && /^define[A-Z]/.test(key)) return (value: unknown) => value;
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "OS") return "ios";
      if (key === "length") return 0;
      return makeStub(true);
    },
    apply: () => makeStub(true),
    construct: () => makeStub(true) as object,
  });
  return proxy;
}

function pluginRequire(pluginDir: string): NodeJS.Require {
  const anchor = existsSync(join(pluginDir, "package.json")) ? join(pluginDir, "package.json") : join(pluginDir, "noop.js");
  return createRequire(anchor);
}

function tryRequire(req: NodeJS.Require, name: string): unknown {
  try {
    return req(name);
  } catch {
    return undefined;
  }
}

export function evaluateFactory<T>(bundle: string, requireModule: (name: string) => unknown): T {
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function") throw new Error("bundle is not executable");
  const exports = factory(requireModule) as { default?: unknown } | null;
  const setup = exports && typeof exports === "object" ? exports.default : undefined;
  if (typeof setup !== "function") throw new Error("bundle must default export a function");
  return setup as T;
}

export type Handler = (input: unknown, context: unknown) => unknown;

export interface ServerEvaluation {
  handlers: Map<string, Handler>;
  registrations: string[];
  evalMs: number;
}

/**
 * Evaluates a server bundle like Paseo's bundle evaluator and runs its contribution against a recording
 * server. Host modules come from the plugin's own node_modules (its devDependencies), like a typecheck.
 */
export function evaluateServerBundle(bundle: string, pluginDir: string, overrides: Record<string, unknown> = {}): ServerEvaluation {
  const req = pluginRequire(pluginDir);
  const requireModule = (name: string) => {
    if (name in overrides) return overrides[name];
    if ((SDK_CLIENT_ONLY as readonly string[]).includes(name)) throw new Error(`${name} is available only in plugin client code`);
    if (name === "@getpaseo/plugin/client/host") throw new Error(`${name} is private to the app host`);
    if (isHostServerModule(name)) return tryRequire(req, name) ?? chainStub();
    return req(name);
  };
  const started = performance.now();
  const setup = evaluateFactory<(server: unknown) => unknown>(bundle, requireModule);
  const evalMs = Math.round(performance.now() - started);
  const handlers = new Map<string, Handler>();
  const registrations: string[] = [];
  const server = new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key === "string"
          ? (first: { name?: string } | string, handler: Handler) => {
              registrations.push(key);
              if (key === "handle") handlers.set(typeof first === "string" ? first : String(first?.name), handler);
              return () => {};
            }
          : undefined,
    },
  );
  setup(server);
  return { handlers, registrations, evalMs };
}

export interface ClientContribution {
  method: string;
  contribution: unknown;
}

export interface ClientEvaluation {
  contributions: ClientContribution[];
  icons: string[];
  setupError: string | null;
}

/** Icon names in a contribution: `icon` fields up to two levels deep (header buttons nest them). */
export function contributionIcons(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 2) return [];
  const icons: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "icon" && typeof child === "string") icons.push(child);
    else if (child && typeof child === "object" && !Array.isArray(child)) icons.push(...contributionIcons(child, depth + 1));
  }
  return icons;
}

/**
 * Evaluates a client bundle in Node with the host's module list enforced and records every `add*` call
 * of the contribution. React Native and SDK client modules are stubs; react and zod are real when installed.
 * A module outside the host list throws the same error the app shows.
 */
export async function evaluateClientBundle(bundle: string, pluginDir: string, settleMs = 50): Promise<ClientEvaluation> {
  const req = pluginRequire(pluginDir);
  const real = new Set(["react", "react/jsx-runtime", "zod", "@getpaseo/plugin"]);
  const requireModule = (name: string) => {
    if (!(CLIENT_HOST_MODULES as readonly string[]).includes(name)) {
      throw new Error(`Module "${name}" is not available in plugin client code`);
    }
    return (real.has(name) ? tryRequire(req, name) : undefined) ?? chainStub();
  };
  const setup = evaluateFactory<(client: unknown) => unknown>(bundle, requireModule);
  const contributions: ClientContribution[] = [];
  const client = new Proxy(
    {},
    {
      get: (_, key) => {
        if (typeof key !== "string") return undefined;
        if (/^add[A-Z]/.test(key)) {
          return (contribution: unknown) => {
            contributions.push({ method: key, contribution });
            return chainStub();
          };
        }
        return chainStub();
      },
    },
  );
  let setupError: string | null = null;
  const asyncErrors: string[] = [];
  const onRejection = (reason: unknown) => asyncErrors.push(String((reason as Error)?.message ?? reason));
  process.on("unhandledRejection", onRejection);
  try {
    setup(client);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  } catch (error) {
    setupError = (error as Error).message;
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  setupError ??= asyncErrors[0] ? `async: ${asyncErrors[0]}` : null;
  return { contributions, icons: [...new Set(contributions.flatMap((entry) => contributionIcons(entry.contribution)))], setupError };
}

export interface SizeReport {
  bytes: number;
  gzipBytes: number;
}

export function sizeReport(bundle: string): SizeReport {
  const buffer = Buffer.from(bundle);
  return { bytes: buffer.byteLength, gzipBytes: gzipSync(buffer).byteLength };
}

export function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(0)} KiB`;
}

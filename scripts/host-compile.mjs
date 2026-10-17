// Reads a plugin manifest, compiles the plugin with Paseo's own compilePlugin and evaluates the server bundle
// with Paseo's own evaluator. The modules come from the installed Paseo app (app.asar, run with
// ELECTRON_RUN_AS_NODE=1) or from a Paseo source checkout (run with that checkout's tsx):
//   <runtime> scripts/host-compile.mjs <plugins-module-dir> <.js|.ts> <plugin-dir> <out-dir>
// Writes client.js, server.js and result.json into out-dir. result.json is rewritten after every stage, so a
// parent that kills this process on timeout still knows how far it got. Handlers are registered, never called.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [plugins, ext, pluginDir, outDir] = process.argv.slice(2);
const exit = process.exit.bind(process);
mkdirSync(outDir, { recursive: true });
const result = { stage: "load", handlers: [], registrations: [], evalMs: null, returnsCleanup: null, cleanupError: null, leaks: [] };
const save = (extra = {}) => writeFileSync(join(outDir, "result.json"), JSON.stringify({ ...result, ...extra }));
const fail = (stage, error) => {
  save({ stage, error: error instanceof Error ? error.message : String(error) });
  exit(0);
};
const pick = (names) => names.map((name) => join(pluginDir, name)).find((path) => existsSync(path)) ?? null;
save();

let host;
try {
  host = {
    ...(await import(join(plugins, `compiler${ext}`))),
    ...(await import(join(plugins, `bundle-evaluator${ext}`))),
    ...(await import(join(plugins, `manifest${ext}`))),
  };
} catch (error) {
  fail("load", error);
}

try {
  result.manifest = await host.readPluginManifest(pluginDir);
} catch (error) {
  fail("manifest", error);
}

let bundles;
try {
  bundles = await host.compilePlugin({
    client: pick(["index.client.ts", "index.client.tsx"]),
    server: pick(["index.server.ts", "index.server.tsx"]),
  });
} catch (error) {
  fail("compile", error);
}
if (bundles.clientBundle) writeFileSync(join(outDir, "client.js"), bundles.clientBundle);
if (bundles.serverBundle) writeFileSync(join(outDir, "server.js"), bundles.serverBundle);
result.stage = "compiled";
save();

if (bundles.serverBundle) {
  // Plugin code runs from here on. Exiting the process is never a pass.
  process.exit = (code) => {
    throw new Error(`plugin code called process.exit(${code ?? ""})`);
  };
  const baseline = process.getActiveResourcesInfo();
  try {
    const started = performance.now();
    const setup = host.evaluateBundle(bundles.serverBundle);
    result.evalMs = Math.round(performance.now() - started);
    const noop = () => {};
    const server = new Proxy(
      {},
      {
        get: (_, key) => {
          if (typeof key !== "string") return undefined;
          return (first) => {
            result.registrations.push(key);
            if (key === "handle") result.handlers.push(typeof first === "string" ? first : String(first?.name));
            return noop;
          };
        },
      },
    );
    const cleanup = setup(server);
    result.returnsCleanup = typeof cleanup === "function";
    if (result.returnsCleanup) {
      // Like a reload or disable: run the cleanup, then list handles it left open.
      try {
        await cleanup();
      } catch (error) {
        result.cleanupError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const counts = new Map();
      for (const kind of process.getActiveResourcesInfo()) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      for (const kind of baseline) counts.set(kind, (counts.get(kind) ?? 0) - 1);
      result.leaks = [...counts].filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`);
    }
  } catch (error) {
    fail("evaluate", error);
  }
}
result.stage = "done";
save();
// The contribution may have left timers or sockets open; they must not keep the check alive.
exit(0);

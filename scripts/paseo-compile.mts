// Validates a plugin manifest, compiles the plugin with Paseo's own compilePlugin and evaluates the server
// bundle with Paseo's own evaluator, all loaded from a Paseo source checkout. Run with that checkout's tsx:
//   <paseo>/node_modules/.bin/tsx scripts/paseo-compile.mts <paseo> <plugin-dir> <out-dir>
// Writes client.js, server.js and result.json into out-dir. Handlers are registered, never called.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [paseo, pluginDir, outDir] = process.argv.slice(2) as [string, string, string];
const plugins = join(paseo, "packages/server/src/server/plugins");
mkdirSync(outDir, { recursive: true });
const result = { handlers: [] as string[], registrations: [] as string[], evalMs: null as number | null };
const finish = (extra: object = {}) => writeFileSync(join(outDir, "result.json"), JSON.stringify({ ...result, ...extra }));
const pick = (names: string[]) => names.map((name) => join(pluginDir, name)).find((path) => existsSync(path)) ?? null;

const { compilePlugin } = await import(join(plugins, "compiler.ts"));
const { evaluateBundle } = await import(join(plugins, "bundle-evaluator.ts"));
const { readPluginManifest } = await import(join(plugins, "manifest.ts"));

try {
  await readPluginManifest(pluginDir);
} catch (error) {
  finish({ stage: "manifest", error: (error as Error).message });
  process.exit(0);
}

let bundles: { clientBundle: string | null; serverBundle: string | null };
try {
  bundles = await compilePlugin({
    client: pick(["index.client.ts", "index.client.tsx"]),
    server: pick(["index.server.ts", "index.server.tsx"]),
  });
} catch (error) {
  finish({ stage: "compile", error: (error as Error).message });
  process.exit(0);
}
if (bundles.clientBundle) writeFileSync(join(outDir, "client.js"), bundles.clientBundle);
if (bundles.serverBundle) writeFileSync(join(outDir, "server.js"), bundles.serverBundle);

if (bundles.serverBundle) {
  try {
    const started = performance.now();
    const setup = evaluateBundle(bundles.serverBundle);
    result.evalMs = Math.round(performance.now() - started);
    const noop = () => {};
    const server = new Proxy({} as Record<string, unknown>, {
      get: (_, key) => {
        if (typeof key !== "string") return undefined;
        return (first: { name?: string } | string | undefined) => {
          result.registrations.push(key);
          if (key === "handle") result.handlers.push(typeof first === "string" ? first : String(first?.name));
          return noop;
        };
      },
    });
    setup(server);
  } catch (error) {
    finish({ stage: "evaluate", error: (error as Error).message });
    process.exit(0);
  }
}
finish();

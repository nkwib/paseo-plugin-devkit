// `ppd dev`: the edit loop. Installs the plugin into the dev daemon, then on every source change reloads it
// (`paseo plugin reload`, about 0.6 s), re-checks the client against the app's rules and streams new plugin log
// lines, until Ctrl+C.
import { watch } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { requireDaemon } from "./daemon.ts";
import { formatInstall, installPlugin, readManifest } from "./install.ts";
import { runPaseo } from "./paseo.ts";

/** Changes that should not trigger a reload: dependencies, VCS, editor and build droppings. */
export function isIgnoredChange(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return parts.some((part) => part === "node_modules" || part === "dist" || (part.startsWith(".") && part !== "." && part !== "..")) || /(~|\.swp|\.tmp)$/.test(path);
}

/** Log lines not printed before. `paseo plugin logs` prints a header, then one line per entry. */
export function newLogLines(output: string, seen: Set<string>): string[] {
  const fresh: string[] = [];
  for (const line of output.split("\n").map((entry) => entry.trimEnd())) {
    if (!line || /^TIME\s+STREAM/.test(line) || seen.has(line)) continue;
    seen.add(line);
    fresh.push(line);
  }
  return fresh;
}

export interface DevOptions {
  name?: string;
  id?: string;
  debounceMs?: number;
  logIntervalMs?: number;
  log?: (line: string) => void;
  /** Resolves to stop watching (tests). Default: never, Ctrl+C ends the process. */
  until?: Promise<void>;
}

export async function devLoop(pluginDir: string, options: DevOptions = {}): Promise<void> {
  const dir = resolve(pluginDir);
  const log = options.log ?? console.log;
  const daemon = requireDaemon(options.name);
  const id = options.id ?? readManifest(dir).id;
  const seen = new Set<string>();
  const printLogs = () => {
    const output = runPaseo(daemon.paseoBin, daemon.home, ["plugin", "logs", id], { timeoutMs: 30_000 }).stdout;
    for (const line of newLogLines(output, seen)) log(`  log ${line}`);
  };

  let running = false;
  let again = false;
  const cycle = async (reason: string) => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const started = Date.now();
        log(`--- ${reason}`);
        const result = await installPlugin(dir, { name: options.name, id, log: () => {} });
        const [head, ...rest] = formatInstall({ ...result, logs: "" }).split("\n");
        log([`${head} in ${Date.now() - started} ms`, ...rest].join("\n"));
        newLogLines(result.logs, seen).forEach((line) => log(`  log ${line}`));
        reason = "changes during reload";
      } while (again);
    } catch (error) {
      log(`error: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };

  await cycle(`installing ${id} into ${daemon.url}`);
  let timer: NodeJS.Timeout | null = null;
  const changed = new Set<string>();
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    const path = file ? String(file) : "";
    if (!path || isIgnoredChange(path)) return;
    changed.add(path.split(sep).join("/"));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...changed];
      changed.clear();
      void cycle(`reloading: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`);
    }, options.debounceMs ?? 300);
  });
  const poll = setInterval(() => {
    if (!running) printLogs();
  }, options.logIntervalMs ?? 2000);
  log(`watching ${relative(process.cwd(), dir) || "."} (Ctrl+C to stop)`);
  try {
    await (options.until ?? new Promise<void>(() => {}));
  } finally {
    watcher.close();
    clearInterval(poll);
    if (timer) clearTimeout(timer);
  }
}

// Child process that evaluates a compiled plugin bundle, so plugin code never runs inside ppd: a timer left
// running, an infinite loop or a process.exit() cannot hang ppd or fake a pass. The parent (isolate.ts)
// enforces the timeout and treats a missing result as a failure.
//   node eval-worker.(ts|js) <request.json>
import { readFileSync, writeFileSync } from "node:fs";
import type { EvalRequest, WorkerResult } from "./isolate.ts";
import { evaluateClientBundle, evaluateServerBundle } from "./bundle.ts";

const request = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as EvalRequest;
const exit = process.exit.bind(process);
const write = (result: WorkerResult) => writeFileSync(request.resultFile, JSON.stringify(result));

// The host runs plugins in their own process; exiting it is never a pass. Throwing surfaces the call site.
process.exit = ((code?: number) => {
  throw new Error(`plugin code called process.exit(${code ?? ""})`);
}) as typeof process.exit;

const bundle = readFileSync(request.bundleFile, "utf8");
let result: WorkerResult;
try {
  if (request.target === "server") {
    const evaluation = evaluateServerBundle(bundle, request.pluginDir);
    result = {
      target: "server",
      handlers: [...evaluation.handlers.keys()],
      registrations: evaluation.registrations,
      evalMs: evaluation.evalMs,
      contractErrors: evaluation.contractErrors,
    };
  } else {
    const evaluation = await evaluateClientBundle(bundle, request.pluginDir, { icons: request.icons ? new Set(request.icons) : null });
    result = {
      target: "client",
      contributions: evaluation.contributions.map((entry) => entry.method),
      icons: evaluation.icons,
      setupError: evaluation.setupError,
      contractErrors: evaluation.contractErrors,
    };
  }
} catch (error) {
  result = { target: request.target, error: (error as Error).message ?? String(error) };
}
write(result);
exit(0);

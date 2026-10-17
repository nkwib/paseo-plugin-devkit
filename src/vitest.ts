// One-line host-contract suite for a plugin repo:
//   import { describeHostContract } from "paseo-plugin-devkit/vitest";
//   describeHostContract(new URL("..", import.meta.url).pathname);
// Each `ppd check` result becomes a test. Skipped checks (no PASEO_SOURCE, no hermesc) are reported as skipped.
import { describe, it } from "vitest";
import { runChecks, type CheckOptions, type CheckResult } from "./check/index.ts";

export function describeHostContract(pluginDir: string, options: CheckOptions & { allowWarnings?: boolean; timeoutMs?: number } = {}): void {
  describe("Paseo host contract", () => {
    let results: Promise<CheckResult[]> | null = null;
    const all = () => (results ??= runChecks(pluginDir, options));
    const ids = ["manifest", "imports", "dependencies", "paseo-compile", "client-requires", "server-requires", "server-eval", "client-eval", "hermes-class", "hermes-parse", "hermes-vm", "lucide-icons", "bundle-size"];
    for (const id of ids) {
      it(id, async (context) => {
        const result = (await all()).find((entry) => entry.id === id || (id === "paseo-compile" && entry.id === "approx-compile"));
        if (!result) return context.skip(`${id} not applicable`);
        if (result.status === "skip") return context.skip(result.message);
        const detail = [result.message, ...(result.details ?? [])].join("\n");
        if (result.status === "fail" || (result.status === "warn" && options.allowWarnings === false)) throw new Error(detail);
      }, options.timeoutMs ?? 300_000);
    }
  });
}

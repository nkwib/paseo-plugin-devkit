// Opt-in: PPD_E2E=1 [PPD_E2E_PORT=N] npx vitest run test/create-e2e.test.ts
// `ppd create` output must pass check and install on an isolated daemon as is; the agent-hook template must
// append its card when a fake agent turn ends.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChecks } from "../src/check/index.ts";
import { findPaseoApp } from "../src/check/compile.ts";
import { createPlugin, TEMPLATES } from "../src/create.ts";
import { daemonDown, daemonUp, type DaemonRecord } from "../src/daemon.ts";
import { agentTimeline, pluginRows, runFakeAgentTurn, sendFakeAgentTurn } from "../src/fake-agent.ts";
import { installPlugin } from "../src/install.ts";
import { findPaseoBin } from "../src/paseo.ts";
import { FIXTURES, scratch } from "./helpers.ts";

const enabled = process.env.PPD_E2E === "1" && findPaseoBin() !== null;
const name = "e2e-create";

async function waitFor<T>(probe: () => T | null, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe.skipIf(!enabled)("ppd create end to end (PPD_E2E=1)", () => {
  let record: DaemonRecord;
  const root = enabled ? scratch("ppd-create-e2e-") : "";

  beforeAll(async () => {
    process.env.PPD_STATE_DIR = scratch("ppd-create-e2e-state-");
    const port = process.env.PPD_E2E_PORT ? Number(process.env.PPD_E2E_PORT) : undefined;
    record = await daemonUp({ name, port, fakeAgent: true, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (!record) return;
    await daemonDown({ name, log: () => {} });
    expect(existsSync(record.home)).toBe(false);
  }, 60_000);

  it.each(TEMPLATES)("the %s template passes check and runs on the daemon", async (template) => {
    const dir = join(root, `e2e-${template}`);
    await createPlugin(dir, { template });
    const failed = (await runChecks(dir)).filter((result) => result.status === "fail");
    expect(failed).toEqual([]);
    const result = await installPlugin(dir, { name, log: () => {} });
    expect(result, result.logs).toMatchObject({ id: `e2e-${template}`, status: "running", error: null, clientErrors: [] });
  }, 300_000);

  it.skipIf(!findPaseoApp())("the agent-hook card is appended when a fake agent turn ends", async () => {
    const workspace = scratch("ppd-create-e2e-ws-");
    const turn = runFakeAgentTurn(
      [
        { think: "Write a note, then run the tests." },
        { write: { path: "notes.md", content: "first\n" } },
        { edit: { path: "notes.md", old: "first", new: "second" } },
        { bash: { command: "npm test", output: "ok", exitCode: 0 } },
        { say: "Done." },
      ],
      { name, cwd: workspace },
    );
    expect(turn.status).toBe("completed");
    expect(readFileSync(join(workspace, "notes.md"), "utf8")).toBe("second\n");

    const [card] = await waitFor(() => {
      const rows = pluginRows(agentTimeline(turn.agentId, { name }), "turn-summary");
      return rows.length ? rows : null;
    });
    expect(card).toMatchObject({
      type: "plugin",
      pluginId: "e2e-agent-hook",
      version: 1,
      data: { agentId: turn.agentId, outcome: "completed", files: [join(workspace, "notes.md")], commands: ["npm test"], toolCalls: 3 },
    });

    // A chat-only turn gets no card; a failing turn reports its outcome.
    sendFakeAgentTurn(turn.agentId, [{ say: "just chatting" }], { name });
    sendFakeAgentTurn(turn.agentId, [{ write: { path: "b.txt", content: "b" } }, { fail: "boom" }], { name });
    const rows = await waitFor(() => {
      const found = pluginRows(agentTimeline(turn.agentId, { name }), "turn-summary");
      return found.length >= 2 ? found : null;
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ data: { outcome: "failed", files: [join(workspace, "b.txt")] } });
  }, 300_000);

  it.skipIf(!findPaseoApp())("the fake agent calls tools on MCP servers a plugin injects", async () => {
    const installed = await installPlugin(join(FIXTURES, "mcp-echo"), { name, log: () => {} });
    expect(installed, installed.logs).toMatchObject({ status: "running" });
    const turn = runFakeAgentTurn(
      [
        { mcp: { server: "echo", tool: "echo", arguments: { text: "hi" } } },
        { mcp: { server: "missing", tool: "echo" } },
      ],
      { name, cwd: scratch("ppd-create-e2e-ws-") },
    );
    const calls = agentTimeline(turn.agentId, { name }).filter((row) => row.type === "tool_call");
    expect(calls).toMatchObject([
      { name: "mcp__echo__echo", status: "completed", detail: { type: "unknown", output: { content: [{ type: "text", text: 'echo {"text":"hi"}' }] } } },
      { name: "mcp__missing__echo", status: "failed" },
    ]);
  }, 300_000);
});

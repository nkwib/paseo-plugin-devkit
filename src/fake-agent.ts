// The credential-free fake agent: a provider plugin shipped in assets/fake-agent that runs a scripted turn
// per prompt. `ppd daemon up --fake-agent` installs it; these helpers drive turns from tests.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPaseoApp } from "./check/compile.ts";
import { requireDaemon } from "./daemon.ts";
import { runPaseo } from "./paseo.ts";
import { run } from "./proc.ts";
import { devDaemonEnv } from "./safety.ts";

export const FAKE_AGENT_ID = "fake-agent";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FAKE_AGENT_DIR = join(ROOT, "assets/fake-agent");
const TIMELINE_SCRIPT = join(ROOT, "scripts/host-timeline.mjs");

// Mirrors assets/fake-agent/server/script.ts (the plugin cannot import from here, the build cannot import from
// there); test/fake-agent.test.ts fails the typecheck if the two drift.
/** One step of a scripted turn. Exactly one key per step. */
export type FakeStep =
  /** An assistant message. */
  | { say: string }
  /** A reasoning item. */
  | { think: string }
  /** Writes the file (relative to the agent cwd) and emits a `Write` tool call with `detail: { type: "write", filePath }`. */
  | { write: { path: string; content: string } }
  /** Replaces `old` with `new` in the file and emits an `Edit` tool call (`type: "edit"`, `filePath`); failed when the file or string is missing. */
  | { edit: { path: string; old: string; new: string } }
  /** Emits a `Bash` tool call (`type: "shell"`). With `run: true` it runs in the agent cwd and reports real output and exit code. */
  | { bash: { command: string; run?: boolean; output?: string; exitCode?: number } }
  /** Calls `tool` on the named MCP server from the session config ("*" = every server); emits `mcp__<server>__<tool>`. */
  | { mcp: { server: string; tool: string; arguments?: Record<string, unknown> } }
  /** Waits this many ms (interruptible). */
  | { sleep: number }
  /** Emits an error item and ends the turn as failed. */
  | { fail: string };

export interface FakeScript {
  steps: FakeStep[];
  /** Pause before every step, in ms (default 0). */
  stepDelayMs?: number;
}

/** A prompt the fake agent runs as a script. Plain prompts get an echo. */
export function fakeAgentPrompt(script: FakeScript | FakeStep[]): string {
  return JSON.stringify(Array.isArray(script) ? { steps: script } : script);
}

export interface TurnOptions {
  /** Dev daemon name (default: "default"). */
  name?: string;
  /** Agent cwd for a new agent (default: process.cwd()). Write and edit steps resolve relative paths here. */
  cwd?: string;
  timeoutMs?: number;
}

export interface TurnResult {
  agentId: string;
  /** The agent status after the turn: "completed", "failed", ... */
  status: string;
}

function parseCliJson(stdout: string, what: string): Record<string, unknown> {
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error(`${what}: no JSON in output:\n${stdout.trim()}`);
  return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
}

/** Creates a fake-agent agent and runs one scripted turn to the end (`paseo run --provider fake-agent`). */
export function runFakeAgentTurn(script: FakeScript | FakeStep[], options: TurnOptions = {}): TurnResult {
  const daemon = requireDaemon(options.name);
  const cwd = resolve(options.cwd ?? process.cwd());
  const result = runPaseo(daemon.paseoBin, daemon.home, ["run", "--provider", FAKE_AGENT_ID, "--cwd", cwd, "--json", fakeAgentPrompt(script)], {
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (result.status !== 0) throw new Error(`fake agent run failed: ${(result.stderr || result.stdout).trim()}`);
  const parsed = parseCliJson(result.stdout, "paseo run");
  return { agentId: String(parsed.agentId), status: String(parsed.status) };
}

/** Sends one more scripted turn to an existing agent and waits for it (`paseo send`). */
export function sendFakeAgentTurn(agentId: string, script: FakeScript | FakeStep[], options: Omit<TurnOptions, "cwd"> = {}): void {
  const daemon = requireDaemon(options.name);
  const result = runPaseo(daemon.paseoBin, daemon.home, ["send", agentId, "--json", "--prompt", fakeAgentPrompt(script)], {
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (result.status !== 0) throw new Error(`fake agent send failed: ${(result.stderr || result.stdout).trim()}`);
}

/** One row of an agent's canonical timeline. Plugin rows have `type: "plugin"`, `kind`, `version`, `data`. */
export type TimelineRow = { type: string; [key: string]: unknown };

/**
 * The agent's canonical timeline, including plugin rows (`paseo logs` omits them). Reads it with the Paseo client
 * from the installed app (app.asar), so it needs the desktop app (or PASEO_APP).
 */
export function agentTimeline(agentId: string, options: { name?: string; timeoutMs?: number } = {}): TimelineRow[] {
  const daemon = requireDaemon(options.name);
  const app = findPaseoApp();
  if (!app) throw new Error("reading a timeline needs the Paseo desktop app (or PASEO_APP): its client is not on npm");
  const result = run(app.helper, [TIMELINE_SCRIPT, join(app.resources, "app.asar/node_modules"), `ws://127.0.0.1:${daemon.port}/ws`, agentId], {
    env: { ...devDaemonEnv(process.env, daemon.home), ELECTRON_RUN_AS_NODE: "1" },
    timeout: options.timeoutMs ?? 60_000,
  });
  if (result.status !== 0) throw new Error(`could not read the timeline of ${agentId}: ${(result.stderr || result.stdout).trim()}`);
  return JSON.parse(result.stdout) as TimelineRow[];
}

/** Plugin rows of one kind, newest last. */
export function pluginRows(timeline: TimelineRow[], kind: string): TimelineRow[] {
  return timeline.filter((row) => row.type === "plugin" && row.kind === kind);
}

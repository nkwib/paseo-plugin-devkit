// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e:
//   plugin-examples/provider-direct/server/provider.ts (provider registration and connection skeleton)
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see
// THIRD_PARTY_NOTICES in the paseo-plugin-devkit package.
// Modified: the example's capabilities and turns are replaced with scripted turns that perform real file effects in
// the agent cwd and call tools on the session's MCP servers.
//
// A credential-free agent provider that runs a scripted turn per prompt (see ./script.ts and the devkit README,
// "Fake agent"). It emits the same timeline items real adapters map their tools onto (write and edit with
// `detail.filePath`, shell), performs the file effects for real in the agent's cwd, and calls tools on the MCP
// servers in its session config, so plugin hooks and injected tools can be tested end to end.
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderPersistence,
  type ProviderRegistration,
  type ProviderSessionConfig,
} from "@getpaseo/plugin/server/provider";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { shellRefusal } from "./isolation";
import { callMcpTool } from "./mcp";
import { defaultScript, scriptFromPrompt, scriptFromTurnsFile, TURNS_FILE, type FakeScript, type FakeStep } from "./script";

const CAPABILITIES = ["prompt.message", "session.persistence"] as const;

interface Session {
  config: ProviderSessionConfig;
  persistence: ProviderPersistence;
  turn: number;
  abort: AbortController | null;
}

type Item = Extract<ProviderEvent, { type: "timeline.item" }>["item"];

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

export function createFakeAgent(): ProviderRegistration {
  return {
    id: "fake-agent",
    label: "Fake agent",
    description: "Scripted, credential-free agent for plugin end-to-end tests",
    async connect(request) {
      return createConnection(negotiateProviderCapabilities(request.capabilities, CAPABILITIES));
    },
  };
}

function createConnection(capabilities: readonly string[]): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const sessions = new Map<string, Session>();
  const emit = (event: ProviderEvent) => {
    for (const listener of listeners) listener(event);
  };
  return {
    version: 1,
    capabilities,
    async send(input) {
      if (input.type !== "catalog" && input.type !== "sessions") requireProviderCapabilities(capabilities, input);
      queueMicrotask(() => {
        dispatch(input, sessions, emit, capabilities).catch((error) => log("dispatch-error", { error: String(error) }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      for (const session of sessions.values()) session.abort?.abort();
      sessions.clear();
      listeners.clear();
    },
  };
}

async function dispatch(input: ProviderInput, sessions: Map<string, Session>, emit: (event: ProviderEvent) => void, capabilities: readonly string[]): Promise<void> {
  switch (input.type) {
    case "catalog":
      emit({
        type: "catalog",
        requestId: input.requestId,
        catalog: { models: [{ id: "scripted", label: "Scripted" }], modes: [{ id: "default", label: "Default" }], defaultModel: "scripted", defaultMode: "default" },
      });
      return;
    case "sessions":
      emit({ type: "sessions", requestId: input.requestId, sessions: [] });
      return;
    case "session.open": {
      const persistence = input.persistence ?? { version: 1, data: { id: input.sessionId } };
      sessions.set(input.sessionId, { config: input.config, persistence, turn: 0, abort: null });
      log("session.open", { sessionId: input.sessionId, resumed: Boolean(input.persistence), mcpServers: Object.keys(input.config.mcpServers) });
      emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId, capabilities, restoration: "core", persistence, cwd: input.config.cwd });
      emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
      return;
    }
    case "session.prompt":
      await prompt(input, sessions, emit);
      return;
    case "session.interrupt":
      sessions.get(input.sessionId)?.abort?.abort();
      emit({ type: "request.completed", requestId: input.requestId });
      return;
    case "session.revert":
      emit({ type: "request.completed", requestId: input.requestId });
      return;
    case "session.close":
      sessions.get(input.sessionId)?.abort?.abort();
      sessions.delete(input.sessionId);
      emit({ type: "session.closed", sessionId: input.sessionId });
      emit({ type: "request.completed", requestId: input.requestId });
      return;
    default:
      if ("requestId" in input) emit({ type: "request.completed", requestId: (input as { requestId: string }).requestId });
  }
}

export function chooseScript(text: string, cwd: string, turn: number): FakeScript {
  const fromPrompt = scriptFromPrompt(text);
  if (fromPrompt) return fromPrompt;
  const turnsFile = join(cwd, TURNS_FILE);
  if (existsSync(turnsFile)) return scriptFromTurnsFile(readFileSync(turnsFile, "utf8"), turn) ?? defaultScript(text);
  return defaultScript(text);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal.aborted) return reject(new Error("canceled"));
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("canceled"));
    }, { once: true });
  });
}

async function prompt(input: Extract<ProviderInput, { type: "session.prompt" }>, sessions: Map<string, Session>, emit: (event: ProviderEvent) => void): Promise<void> {
  const session = sessions.get(input.sessionId);
  if (!session) throw new Error(`unknown session ${input.sessionId}`);
  session.turn += 1;
  const n = session.turn;
  const turnId = `fake-turn-${n}`;
  const sessionId = input.sessionId;
  const abort = new AbortController();
  session.abort = abort;
  const text = input.prompt.input.type === "message" ? input.prompt.input.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  const item = (value: Item) => emit({ type: "timeline.item", sessionId, item: value });

  item({ type: "user_message", id: `u-${n}`, text, clientMessageId: input.prompt.clientMessageId });
  emit({ type: "session.prompt_result", sessionId, clientMessageId: input.prompt.clientMessageId, result: { type: "turn", turnId } });
  emit({ type: "session.turn", sessionId, turnId, state: "started" });

  const finish = (state: "completed" | "failed" | "canceled", message?: string) => {
    session.abort = null;
    emit({ type: "session.persistence", sessionId, persistence: session.persistence });
    emit({ type: "session.turn", sessionId, turnId, state, ...(message ? { error: { message } } : {}) });
    log("turn", { sessionId, turn: n, state, ...(message ? { error: message } : {}) });
  };

  let script: FakeScript;
  try {
    script = chooseScript(text, session.config.cwd, n);
  } catch (error) {
    item({ type: "error", id: `err-${n}`, message: `fake-agent: invalid script: ${(error as Error).message}` });
    return finish("failed", (error as Error).message);
  }

  try {
    for (const [index, step] of script.steps.entries()) {
      if (script.stepDelayMs) await sleep(script.stepDelayMs, abort.signal);
      const failed = await runStep(step, `${n}-${index}`, session, item, abort.signal);
      if (abort.signal.aborted) return finish("canceled");
      if (failed !== null) return finish("failed", failed);
    }
  } catch (error) {
    if (abort.signal.aborted) return finish("canceled");
    item({ type: "error", id: `err-${n}`, message: `fake-agent: ${(error as Error).message}` });
    return finish("failed", (error as Error).message);
  }
  finish("completed");
}

/** Runs one step. Returns an error message when the step fails the turn (`fail`, a refused command), else null. */
export async function runStep(step: FakeStep, id: string, session: Session, item: (value: Item) => void, signal: AbortSignal): Promise<string | null> {
  const cwd = session.config.cwd;
  const abs = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
  const tool = (name: string, detail: Extract<Item, { type: "tool_call" }>["detail"], error: string | null = null) =>
    item({ type: "tool_call", id: `t-${id}`, callId: `t-${id}`, name, detail, ...(error === null ? { status: "completed", error: null } : { status: "failed", error }) } as Item);

  if ("say" in step) item({ type: "assistant_message", id: `a-${id}`, text: step.say });
  else if ("think" in step) item({ type: "reasoning", id: `r-${id}`, text: step.think } as Item);
  else if ("sleep" in step) await sleep(step.sleep, signal);
  else if ("fail" in step) {
    item({ type: "error", id: `err-${id}`, message: step.fail } as Item);
    return step.fail;
  } else if ("write" in step) {
    const filePath = abs(step.write.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, step.write.content);
    tool("Write", { type: "write", filePath, content: step.write.content });
  } else if ("edit" in step) {
    const filePath = abs(step.edit.path);
    const before = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
    const detail = { type: "edit" as const, filePath, oldString: step.edit.old, newString: step.edit.new };
    if (before === null) tool("Edit", detail, `file not found: ${filePath}`);
    else if (!before.includes(step.edit.old)) tool("Edit", detail, `old string not found in ${filePath}`);
    else {
      writeFileSync(filePath, before.replace(step.edit.old, step.edit.new));
      tool("Edit", detail);
    }
  } else if ("bash" in step) {
    const { command, run = false } = step.bash;
    if (!run) {
      const exitCode = step.bash.exitCode ?? 0;
      tool("Bash", { type: "shell", command, cwd, output: step.bash.output ?? "", exitCode }, exitCode === 0 ? null : `exit code ${exitCode}`);
    } else {
      const refusal = shellRefusal();
      if (refusal !== null) {
        tool("Bash", { type: "shell", command, cwd, output: refusal, exitCode: 126 }, refusal);
        return refusal;
      }
      const result = await new Promise<{ output: string; exitCode: number }>((done) => {
        execFile("/bin/sh", ["-c", command], { cwd, timeout: 60_000, signal }, (error, stdout, stderr) => {
          const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
          done({ output: `${stdout}${stderr}`, exitCode: code });
        });
      });
      const error = signal.aborted ? "canceled" : result.exitCode === 0 ? null : `exit code ${result.exitCode}`;
      tool("Bash", { type: "shell", command, cwd, output: result.output, exitCode: result.exitCode }, error);
    }
  } else if ("mcp" in step) {
    const { tool: toolName, arguments: args = {} } = step.mcp;
    const servers = step.mcp.server === "*" ? Object.keys(session.config.mcpServers) : [step.mcp.server];
    for (const [offset, name] of servers.entries()) {
      const server = session.config.mcpServers[name];
      const callId = `${id}-${offset}`;
      const input = { server: name, tool: toolName, arguments: args };
      const mcpItem = (output: unknown, error: string | null) =>
        item({ type: "tool_call", id: `m-${callId}`, callId: `m-${callId}`, name: `mcp__${name}__${toolName}`, detail: { type: "unknown", input, output }, ...(error === null ? { status: "completed", error: null } : { status: "failed", error }) } as Item);
      if (!server) {
        mcpItem(null, `no MCP server "${name}" in the session config (have: ${Object.keys(session.config.mcpServers).join(", ") || "none"})`);
        continue;
      }
      const started = Date.now();
      try {
        const output = await callMcpTool(server, session.config.env, toolName, args);
        log("mcp-call", { server: name, tool: toolName, ok: true, ms: Date.now() - started });
        mcpItem(output, null);
      } catch (error) {
        log("mcp-call", { server: name, tool: toolName, ok: false, ms: Date.now() - started, error: String(error) });
        mcpItem(null, String(error));
      }
    }
  }
  return null;
}

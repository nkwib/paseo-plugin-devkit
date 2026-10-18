// Minimal MCP client for the servers in a session's config: initialize, then tools/call. HTTP (JSON
// responses) and stdio, like a real harness consuming `mcpServers`.
import type { ProviderMcpServerConfig } from "@getpaseo/plugin/server/provider";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const TIMEOUT_MS = 10_000;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

function messages(tool: string, args: Record<string, unknown>) {
  return [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ppd-fake-agent", version: "0.1.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } },
  ];
}

/** Calls one tool and returns its `result`. Throws on transport errors and JSON-RPC errors. */
export async function callMcpTool(
  server: ProviderMcpServerConfig,
  launchEnv: Readonly<Record<string, string>>,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const exchange = messages(tool, args);
  const last = server.type === "stdio" ? await stdioExchange(server, launchEnv, exchange) : await httpExchange(server, exchange);
  if (last?.error) throw new Error(last.error.message);
  return last?.result ?? null;
}

async function httpExchange(server: Extract<ProviderMcpServerConfig, { type: "http" | "sse" }>, exchange: object[]): Promise<JsonRpcResponse | undefined> {
  let last: JsonRpcResponse | undefined;
  let session: string | null = null;
  for (const message of exchange) {
    const response: Response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(session ? { "mcp-session-id": session } : {}),
        ...server.headers,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    if (response.status === 202) continue;
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    const text = await response.text();
    // Streamable HTTP may answer with an SSE stream; take the last data line.
    const body = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split("\n").filter((line: string) => line.startsWith("data:")).map((line: string) => line.slice(5).trim()).pop() ?? "{}"
      : text;
    last = JSON.parse(body) as JsonRpcResponse;
    if (last.error) return last;
  }
  return last;
}

function stdioExchange(
  server: Extract<ProviderMcpServerConfig, { type: "stdio" }>,
  launchEnv: Readonly<Record<string, string>>,
  exchange: Array<{ id?: number }>,
): Promise<JsonRpcResponse | undefined> {
  // Like Claude Code: the stdio server inherits the harness env (which carries PASEO_AGENT_ID) plus its own env.
  const child = spawn(server.command, server.args ?? [], { env: { ...process.env, ...launchEnv, ...server.env }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line) as JsonRpcResponse;
      if (message.id !== undefined) pending.get(message.id)?.(message);
    } catch {}
  });
  const run = async () => {
    let last: JsonRpcResponse | undefined;
    for (const message of exchange) {
      const wait = message.id === undefined ? null : new Promise<JsonRpcResponse>((resolve) => pending.set(message.id!, resolve));
      child.stdin.write(`${JSON.stringify(message)}\n`);
      if (!wait) continue;
      last = await wait;
      if (last.error) return last;
    }
    return last;
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stdio MCP server timed out after ${TIMEOUT_MS} ms; stderr: ${stderr.slice(0, 300)}`));
    }, TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    run().then(
      (value) => {
        clearTimeout(timer);
        child.kill();
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        child.kill();
        reject(error);
      },
    );
  });
}

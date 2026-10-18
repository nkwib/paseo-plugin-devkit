import { createServer } from "node:http";

export interface Tool {
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): string | Promise<string>;
}

/**
 * A minimal MCP server over Streamable HTTP with JSON responses (initialize, ping, tools/list, tools/call) on a
 * free loopback port. It has no authentication: anything on this machine can call it. `url()` is null until
 * the server is listening.
 */
export function startMcpServer(name: string, tools: Record<string, Tool>) {
  const http = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      let message: { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      try {
        message = JSON.parse(body || "{}");
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (message.id === undefined) {
        response.writeHead(202).end(); // a notification: no reply
        return;
      }
      const reply = (payload: object) =>
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload }));

      switch (message.method) {
        case "initialize":
          return reply({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "0.1.0" } } });
        case "ping":
          return reply({ result: {} });
        case "tools/list":
          return reply({ result: { tools: Object.entries(tools).map(([tool, { description, inputSchema }]) => ({ name: tool, description, inputSchema })) } });
        case "tools/call": {
          const tool = tools[message.params?.name ?? ""];
          if (!tool) return reply({ error: { code: -32602, message: `unknown tool: ${message.params?.name}` } });
          try {
            return reply({ result: { content: [{ type: "text", text: await tool.run(message.params?.arguments ?? {}) }] } });
          } catch (error) {
            return reply({ result: { isError: true, content: [{ type: "text", text: String(error) }] } });
          }
        }
        default:
          return reply({ error: { code: -32601, message: `method not found: ${message.method}` } });
      }
    });
  });
  http.listen(0, "127.0.0.1");

  return {
    url() {
      const address = http.address();
      return address && typeof address === "object" ? `http://127.0.0.1:${address.port}/mcp` : null;
    },
    close() {
      http.close();
    },
  };
}

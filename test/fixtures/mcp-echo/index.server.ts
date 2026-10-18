import { createServer } from "node:http";
import type { PluginServerContext } from "@getpaseo/plugin/server";

// Minimal MCP Streamable HTTP server (JSON responses) with one tool, `echo`, injected in before("agent.create").
export default function contribute(server: PluginServerContext) {
  const http = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = JSON.parse(body || "{}");
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-echo", version: "0.0.0" } }
          : message.method === "tools/call"
            ? { content: [{ type: "text", text: `echo ${JSON.stringify(message.params.arguments)}` }] }
            : {};
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  http.listen(0, "127.0.0.1");
  server.before("agent.create", ({ request }) => {
    const address = http.address();
    if (!address || typeof address === "string") return undefined;
    const echo = { type: "http" as const, url: `http://127.0.0.1:${address.port}/mcp` };
    return { ...request, config: { ...request.config, mcpServers: { ...request.config.mcpServers, echo } } };
  });
  return () => {
    http.close();
  };
}

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { startMcpServer } from "./server/mcp-server";

export default function contribute(server: PluginServerContext) {
  const mcp = startMcpServer("word-tools", {
    count_words: {
      description: "Count the words in a text.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: ({ text }) => `${String(text ?? "").split(/\s+/).filter(Boolean).length} words`,
    },
  });

  // Every new agent gets the server as "words". Spread what is there: the user and other plugins add servers too.
  const stopInjecting = server.before("agent.create", ({ request }) => {
    const url = mcp.url();
    if (!url) return undefined; // not listening yet: keep the request as it is
    const words = { type: "http" as const, url };
    return { ...request, config: { ...request.config, mcpServers: { ...request.config.mcpServers, words } } };
  });

  // Event hooks run on the daemon even with no app open. Output lands in `paseo plugin logs word-tools`.
  const stopLogging = server.on("agent.turn_ended", (event) => {
    const detail = event.outcome.kind === "failed" ? `: ${event.outcome.error.message}` : "";
    console.log(`turn ${event.outcome.kind} for ${event.agent.provider} agent ${event.agent.id}${detail}`);
  });

  return () => {
    stopLogging();
    stopInjecting();
    mcp.close();
  };
}

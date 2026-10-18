import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { summarizeTurn } from "./server/summarize";
import { listSummariesRpc, SUMMARY_KIND, SUMMARY_VERSION, type TurnSummary } from "./shared/turn-summary";

const KEEP_PER_AGENT = 50;

export default function contribute(server: PluginServerContext) {
  const byAgent = new Map<string, TurnSummary[]>();

  const stopListening = server.on("agent.turn_ended", async (event, { paseo }) => {
    const summary = summarizeTurn(event);
    if (summary.toolCalls === 0) return; // plain chat turns get no card
    const kept = [...(byAgent.get(summary.agentId) ?? []), summary].slice(-KEEP_PER_AGENT);
    byAgent.set(summary.agentId, kept);
    await paseo.agents.ref(summary.agentId).timeline.append({
      type: "plugin",
      id: `turn-summary-${randomUUID()}`,
      kind: SUMMARY_KIND,
      version: SUMMARY_VERSION,
      data: summary,
    });
    console.log(`turn summary appended for ${summary.agentId}: ${summary.files.length} file(s), ${summary.commands.length} command(s)`);
  });

  server.handle(listSummariesRpc, ({ agentId }) => ({ summaries: byAgent.get(agentId) ?? [] }));

  return () => {
    stopListening();
  };
}

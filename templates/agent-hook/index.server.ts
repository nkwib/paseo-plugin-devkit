import { randomUUID } from "node:crypto";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { summarizeTurn, type TurnEndedEvent } from "./server/summarize";
import { listSummariesRpc, SUMMARY_KIND, SUMMARY_VERSION, type TurnSummary } from "./shared/turn-summary";

const KEEP_PER_AGENT = 50;
/** Rows read back per turn. A turn longer than this is summarized from its last rows. */
const TIMELINE_TAIL = 200;

/**
 * Paseo 0.14 and later emit `agent.turn_ended` with an empty `timeline` (the daemon publishes the hook with
 * `timeline: []`), so the turn is read back from the agent's own timeline. `currentTurn` then cuts it at the last
 * user message, as it does for the rows an older host passed in the event.
 */
async function turnTimeline(paseo: PluginHandlerContext["paseo"], agentId: string): Promise<TurnEndedEvent["timeline"]> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TIMELINE_TAIL, projection: "projected" });
  return page.entries.map((entry) => entry.item);
}

export default function contribute(server: PluginServerContext) {
  const byAgent = new Map<string, TurnSummary[]>();

  const stopListening = server.on("agent.turn_ended", async (event, { paseo }) => {
    const timeline = event.timeline.length ? event.timeline : await turnTimeline(paseo, event.agent.id);
    const summary = summarizeTurn({ ...event, timeline });
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

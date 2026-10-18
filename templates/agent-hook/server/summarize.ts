import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { TurnSummary } from "../shared/turn-summary";

export type TurnEndedEvent = PluginLifecycleEvents["agent.turn_ended"];
type TimelineItem = TurnEndedEvent["timeline"][number];

/** `turn_ended` carries the whole conversation: the turn that just ended starts after the last user message. */
export function currentTurn(timeline: readonly TimelineItem[]): readonly TimelineItem[] {
  let start = 0;
  timeline.forEach((item, index) => {
    if (item.type === "user_message") start = index + 1;
  });
  return timeline.slice(start);
}

/**
 * Files come from write and edit tool calls (`detail.filePath`). Files a shell command writes are not
 * attributed by the host; only the command is known.
 */
export function summarizeTurn(event: TurnEndedEvent, endedAt: Date = new Date()): TurnSummary {
  const files = new Set<string>();
  const commands: string[] = [];
  let toolCalls = 0;
  for (const item of currentTurn(event.timeline)) {
    if (item.type !== "tool_call") continue;
    toolCalls += 1;
    const detail = item.detail;
    if (detail.type === "write" || detail.type === "edit") files.add(detail.filePath);
    else if (detail.type === "shell") commands.push(detail.command);
  }
  return {
    agentId: event.agent.id,
    turnId: event.turnId,
    outcome: event.outcome.kind,
    files: [...files],
    commands,
    toolCalls,
    endedAt: endedAt.toISOString(),
  };
}

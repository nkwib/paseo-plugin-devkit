import { describe, expect, it } from "vitest";
import { currentTurn, summarizeTurn, type TurnEndedEvent } from "../server/summarize";

const agent = { id: "agent-1", workspaceId: null, parentAgentId: null, provider: "fake-agent", cwd: "/tmp/ws", title: null };

function event(timeline: unknown[]): TurnEndedEvent {
  return { agent, turnId: "turn-2", outcome: { kind: "completed" }, timeline: timeline as TurnEndedEvent["timeline"] };
}

const toolCall = (id: string, detail: object) => ({ type: "tool_call", id, callId: id, name: "tool", status: "completed", error: null, detail });

describe("summarizeTurn", () => {
  it("summarizes only the turn after the last user message", () => {
    const summary = summarizeTurn(
      event([
        { type: "user_message", text: "first" },
        toolCall("old", { type: "write", filePath: "/tmp/ws/old.txt" }),
        { type: "user_message", text: "second" },
        toolCall("w", { type: "write", filePath: "/tmp/ws/a.txt" }),
        toolCall("e", { type: "edit", filePath: "/tmp/ws/a.txt" }),
        toolCall("s", { type: "shell", command: "npm test" }),
        { type: "assistant_message", text: "done" },
      ]),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(summary).toEqual({
      agentId: "agent-1",
      turnId: "turn-2",
      outcome: "completed",
      files: ["/tmp/ws/a.txt"],
      commands: ["npm test"],
      toolCalls: 3,
      endedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns the whole timeline when there is no user message", () => {
    expect(currentTurn(event([{ type: "assistant_message", text: "hi" }]).timeline)).toHaveLength(1);
  });
});

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Timeline row kind. Bump `SUMMARY_VERSION` when the data shape changes. */
export const SUMMARY_KIND = "turn-summary";
export const SUMMARY_VERSION = 1;

export const summarySchema = z.object({
  agentId: z.string(),
  turnId: z.string().nullable(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  files: z.array(z.string()),
  commands: z.array(z.string()),
  toolCalls: z.number().int(),
  endedAt: z.string(),
});
export type TurnSummary = z.output<typeof summarySchema>;

export const listSummariesRpc = defineRpc({
  name: "summaries.list",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ summaries: z.array(summarySchema) }),
});

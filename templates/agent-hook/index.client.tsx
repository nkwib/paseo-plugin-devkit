import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SummariesScreen } from "./client/summaries-screen";
import { makeSummaryCard, SCREEN_ID } from "./client/summary-card";
import { SUMMARY_KIND, SUMMARY_VERSION, summarySchema } from "./shared/turn-summary";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineRenderer({ kind: SUMMARY_KIND, version: SUMMARY_VERSION, schema: summarySchema, Component: makeSummaryCard(client) }),
    client.addScreen({ id: SCREEN_ID, title: "Turn summaries", Component: SummariesScreen }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

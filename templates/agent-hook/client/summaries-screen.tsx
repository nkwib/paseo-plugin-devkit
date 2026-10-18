import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { listSummariesRpc } from "../shared/turn-summary";

export function SummariesScreen({ params, theme, layout }: PluginScreenProps) {
  const listSummaries = useRpc(listSummariesRpc);
  const agentId = params.agentId ?? "";
  const query = useQuery({
    queryKey: ["turn-summaries", agentId],
    queryFn: () => listSummaries({ agentId }),
    enabled: agentId !== "",
  });
  const c = theme.colors;
  const summaries = query.data?.summaries ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 12 }}>
      {query.error ? <Text style={{ color: c.foreground }}>Could not load summaries: {(query.error as Error).message}</Text> : null}
      {!query.isLoading && summaries.length === 0 ? (
        <Text style={{ color: c.foregroundMuted }}>No turns with tool calls since the plugin started.</Text>
      ) : null}
      {[...summaries].reverse().map((summary, index) => (
        <View key={`${summary.endedAt}-${index}`} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, gap: 4 }}>
          <Text style={{ color: c.foreground, fontWeight: "600" }}>
            {new Date(summary.endedAt).toLocaleTimeString()}: {summary.outcome}, {summary.toolCalls} tool call{summary.toolCalls === 1 ? "" : "s"}
          </Text>
          {summary.files.map((file) => (
            <Text key={file} style={{ color: c.foreground, fontFamily: "monospace", fontSize: 12 }}>
              {file}
            </Text>
          ))}
          {summary.commands.map((command, index) => (
            <Text key={`${index}-${command}`} style={{ color: c.foregroundMuted, fontFamily: "monospace", fontSize: 12 }}>
              $ {command}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

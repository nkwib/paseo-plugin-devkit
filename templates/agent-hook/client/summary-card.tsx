import { Pressable, Text, View } from "react-native";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { TurnSummary } from "../shared/turn-summary";

export const SCREEN_ID = "summaries";
const SHOWN_FILES = 5;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Timeline renderers get no navigation props: close over the `client` from `contribute` to open a screen. */
export function makeSummaryCard(client: PluginClientContext) {
  return function SummaryCard({ item, theme, agentId }: PluginTimelineItemProps<TurnSummary>) {
    const c = theme.colors;
    const { files, commands, outcome } = item.data;
    const more = files.length - SHOWN_FILES;
    return (
      <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, gap: 6, backgroundColor: c.surface1 }}>
        <Text style={{ color: c.foreground, fontWeight: "600" }}>
          Turn summary{outcome === "completed" ? "" : ` (${outcome})`}
        </Text>
        <Text style={{ color: c.foregroundMuted }}>
          {files.length} file{files.length === 1 ? "" : "s"} changed, {commands.length} command{commands.length === 1 ? "" : "s"} run
        </Text>
        {files.slice(0, SHOWN_FILES).map((file) => (
          <Text key={file} numberOfLines={1} style={{ color: c.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {basename(file)}
          </Text>
        ))}
        {more > 0 ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>and {more} more</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="All turns"
          onPress={() => client.openScreen({ screenId: SCREEN_ID, params: { agentId } })}
          style={{ alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: c.accent }}
        >
          <Text style={{ color: c.accentForeground, fontSize: 13 }}>All turns</Text>
        </Pressable>
      </View>
    );
  };
}

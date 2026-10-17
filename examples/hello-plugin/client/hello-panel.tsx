import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { greetRpc } from "../shared/rpc";

export function HelloPanel({ theme }: PluginWorkspacePanelProps) {
  const greet = useRpc(greetRpc);
  const [name, setName] = useState("Paseo");
  const [reply, setReply] = useState<string | null>(null);
  const c = theme.colors;

  const send = async () => {
    try {
      const { text, count } = await greet({ name: name.trim() || "Paseo" });
      setReply(`${text} Call #${count}.`);
    } catch (error) {
      setReply(`RPC failed: ${(error as Error).message}`);
    }
  };

  return (
    <View style={{ flex: 1, gap: 12, padding: 16, backgroundColor: c.surface0 }}>
      <Text style={{ color: c.foreground, fontSize: 16 }}>Say hello to the plugin server</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={send}
        accessibilityLabel="Name"
        style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8 }}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Greet" onPress={send} style={{ alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.accent }}>
        <Text style={{ color: c.accentForeground }}>Greet</Text>
      </Pressable>
      {reply ? <Text style={{ color: c.foregroundMuted }}>{reply}</Text> : null}
    </View>
  );
}

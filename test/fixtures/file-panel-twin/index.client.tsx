import type { PluginClientContext, PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Text } from "react-native";

// Same title as file-panel-fixture, so the picker offers two "Fixture" panels.
function Twin({ theme }: PluginFilePanelProps) {
  return <Text style={{ color: theme.colors.foreground }}>Twin panel</Text>;
}

export default function contribute(client: PluginClientContext) {
  const remove = client.addFilePanel({ id: "twin", title: "Fixture", icon: "FileText", files: { extensions: ["csv", "tsv"] }, Component: Twin });
  return () => remove();
}

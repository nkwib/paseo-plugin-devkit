import { useFileText, type PluginClientContext, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Text } from "react-native";

function Reader({ file, theme }: PluginFilePanelProps) {
  const state = useFileText(file);
  return <Text style={{ color: theme.colors.foreground }}>{state.status === "error" ? "Fixture file unavailable" : state.status === "ready" ? state.text : "Loading fixture"}</Text>;
}

export default function contribute(client: PluginClientContext) {
  const remove = client.addFilePanel({ id: "reader", title: "Fixture", icon: "FileText", files: { extensions: ["csv", "tsv"] }, Component: Reader });
  return () => remove();
}

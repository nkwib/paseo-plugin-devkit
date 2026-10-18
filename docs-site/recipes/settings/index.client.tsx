import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AlertsScreen } from "./client/alerts-screen";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSettingsScreen({ id: "alerts", title: "Turn alerts", icon: "Bell", Component: AlertsScreen }),
    client.addCommandCenterItem({
      id: "open-alert-settings",
      title: "Turn alert settings",
      icon: "Settings",
      context: "global",
      onSelect: ({ openSettings }) => openSettings("alerts"),
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

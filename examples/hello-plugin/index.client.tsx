import type { PluginClientContext } from "@getpaseo/plugin/client";
import { HelloPanel } from "./client/hello-panel";

const PANEL_ID = "hello";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({ id: PANEL_ID, title: "Hello", icon: "Hand", context: "workspace", Component: HelloPanel }),
    client.addCommandCenterItem({
      id: "open-hello",
      title: "Open Hello panel",
      icon: "MessageCircle",
      context: "workspace",
      onSelect: ({ openPanel }) => openPanel(PANEL_ID),
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

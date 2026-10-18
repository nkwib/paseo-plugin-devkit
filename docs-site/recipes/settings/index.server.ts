import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/preferences";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);

  const stopWatching = settings.subscribe((next) => {
    if (next.status === "ready") console.log(`alert settings saved: ${JSON.stringify(next.values)}`);
  });

  const stopListening = server.on("agent.turn_ended", async (event) => {
    const current = await settings.read();
    if (current.status !== "ready" || !current.values.enabled) return;
    if (current.values.turns === "failed" && event.outcome.kind === "completed") return;
    console.log(`alert: turn ${event.outcome.kind} for agent ${event.agent.id}`);
  });

  return () => {
    stopListening();
    stopWatching();
  };
}

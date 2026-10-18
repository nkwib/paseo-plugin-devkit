import { defineSettings } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

const preferences = defineSettings({ id: "prefs", scope: "host", version: 1, schema: z.object({ on: z.boolean().default(true) }) });

// The handle's read() and subscribe() are used during contribute, as the host allows.
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const stop = settings.subscribe((next) => {
    if (next.status === "ready") console.log(next.values.on);
  });
  void settings.read().then((current) => {
    if (current.status !== "ready") throw new Error(`settings are ${current.status}`);
  });
  return () => stop();
}

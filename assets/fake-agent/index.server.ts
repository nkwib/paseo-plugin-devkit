import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createFakeAgent } from "./server/provider";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createFakeAgent());
  return () => {};
}

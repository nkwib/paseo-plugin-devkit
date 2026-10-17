import type { PluginServerContext } from "@getpaseo/plugin/server";
import { greet } from "./server/greet";
import { greetRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(greetRpc, ({ name }) => greet(name));
  return () => {};
}

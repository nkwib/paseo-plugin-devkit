import { helloRpc } from "./shared/rpc";
import { hello } from "./server/hello";

export default function contribute(server: { handle(contract: unknown, handler: (input: { who: string }) => unknown): () => void }) {
  return server.handle(helloRpc, async (input) => hello(input));
}

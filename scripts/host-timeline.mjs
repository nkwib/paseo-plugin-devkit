// Prints an agent's canonical timeline (including plugin rows) as JSON, using the Paseo client that ships in the
// installed app (app.asar, run with ELECTRON_RUN_AS_NODE=1). The CLI's `paseo logs` omits plugin rows.
//   <runtime> scripts/host-timeline.mjs <app.asar/node_modules> <ws url> <agent id>
import { join } from "node:path";

const [modules, url, agentId] = process.argv.slice(2);
const { DaemonClient } = await import(join(modules, "@getpaseo/client/dist/daemon-client.js"));
const { createPaseoApi } = await import(join(modules, "@getpaseo/client/dist/index.js"));
const { default: WebSocket } = await import(join(modules, "ws/wrapper.mjs"));

const client = new DaemonClient({
  url,
  clientId: "ppd-timeline",
  clientType: "cli",
  webSocketFactory: (target, options) => new WebSocket(target, options),
  reconnect: { enabled: false },
});
const timer = setTimeout(() => {
  console.error("timed out reading the timeline");
  process.exit(1);
}, 30_000);
try {
  await client.connect();
  const page = await createPaseoApi(client).agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 1000 });
  const rows = page.entries ?? page.rows ?? page.items ?? [];
  process.stdout.write(JSON.stringify(rows.map((row) => row.item ?? row)));
} finally {
  clearTimeout(timer);
  await client.close();
}

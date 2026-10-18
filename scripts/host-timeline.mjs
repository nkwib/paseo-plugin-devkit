// Prints an agent's canonical timeline (including plugin rows) as JSON, using the Paseo client that ships in the
// installed app (app.asar, run with ELECTRON_RUN_AS_NODE=1). The CLI's `paseo logs` omits plugin rows.
//   <runtime> scripts/host-timeline.mjs <app.asar/node_modules> <ws url> <agent id>
// Exits 2 with a "ppd-layout:" line on stderr when the app's client is not where or what ppd expects.
import { join } from "node:path";

const [modules, url, agentId] = process.argv.slice(2);
const layout = (detail) => {
  console.error(`ppd-layout: ${detail}`);
  process.exit(2);
};
const load = async (path) => {
  try {
    return await import(join(modules, path));
  } catch (error) {
    return layout(`cannot import ${path}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
};
const { DaemonClient } = await load("@getpaseo/client/dist/daemon-client.js");
const { createPaseoApi } = await load("@getpaseo/client/dist/index.js");
const { default: WebSocket } = await load("ws/wrapper.mjs");
if (typeof DaemonClient !== "function" || typeof createPaseoApi !== "function" || typeof WebSocket !== "function") {
  layout("the app's client modules no longer export DaemonClient, createPaseoApi and a ws WebSocket");
}

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
  if (page?.error) throw new Error(typeof page.error === "string" ? page.error : JSON.stringify(page.error));
  const rows = page?.entries ?? page?.rows ?? page?.items;
  if (!Array.isArray(rows)) layout(`unexpected timeline page (keys: ${Object.keys(page ?? {}).join(", ") || "none"})`);
  process.stdout.write(JSON.stringify(rows.map((row) => row.item ?? row)));
} finally {
  clearTimeout(timer);
  await client.close();
}

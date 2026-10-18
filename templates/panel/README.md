# {{name}}

A Paseo plugin: a workspace panel that calls one server RPC.

- `shared/rpc.ts`: the typed RPC contract, shared by client and server.
- `index.server.ts`, `server/`: the RPC handler. It runs in the plugin's Node process.
- `index.client.tsx`, `client/`: the "Hello" workspace panel and an "Open Hello panel" Command Center item.

## Develop

```sh
npm install
npm run check                  # ppd check: compile and evaluate against the installed Paseo app
npm test                       # unit tests plus the host-contract suite
npx ppd daemon up --workspace /tmp/{{id}}-ws
npx ppd dev                    # install, then reload on every change
npx ppd web --command "Open Hello panel" --click Greet --shot out/panel.png
npx ppd daemon down
```

The dev daemon is isolated (temp home, never port 6767), so your own Paseo is not touched.

# hello-plugin

The smallest useful Paseo plugin, used by the devkit tests and README demo.

- `shared/rpc.ts`: one typed RPC, `hello.greet`.
- `index.server.ts`, `server/greet.ts`: the handler (runs in the plugin's Node child).
- `index.client.tsx`, `client/hello-panel.tsx`: a workspace panel that calls the RPC, plus a Command Center item, "Open Hello panel", that opens it.

From the devkit root:

```sh
npx ppd check examples/hello-plugin
npx ppd registry precheck examples/hello-plugin
npx ppd daemon up --workspace /tmp/demo-workspace
npx ppd install examples/hello-plugin
npx ppd web --command "Open Hello panel" --click Greet --shot out/hello.png
npx ppd daemon down
```

To typecheck it or run the Hermes checks, `npm install` inside this directory first (it pulls `react-native`, which ships `hermesc`). To start your own plugin, copy this directory and change the `id` in `paseo-plugin.json`.

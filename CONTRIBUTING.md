# Contributing

Issues and PRs are welcome. Keep PRs to one focused change and explain the plugin pain it addresses.

## Setup

```sh
git clone https://github.com/nkwib/paseo-plugin-devkit.git
cd paseo-plugin-devkit
npm ci                 # also builds dist/
npm run typecheck
npm test
node dist/cli.js check examples/hello-plugin
```

Node 22.18+ runs the TypeScript sources directly, so `node src/cli.ts <command>` works without a build.

## Ground rules

- **Never touch the user's Paseo.** No code path may bind, probe or target port 6767 or write under `~/.paseo`. New commands that talk to a daemon go through `requireDaemon`, `runPaseo` and the guards in `src/safety.ts`. Add a test when you add a guard.
- **Devices are read-only.** `ppd android` must not send input, key events or settings changes.
- **Public actions stay opt-in.** Anything that pushes, tags, opens PRs or files issues prints the commands by default and needs a TTY confirmation or `--yes`.
- **Host-contract facts need a source.** When a check encodes a Paseo limit, cite the Paseo file or issue in a comment next to the constant (see `src/check/host.ts`).
- Tests that need Paseo, Hermes or a browser must skip cleanly when the tool is missing, so CI stays green on a bare runner.
- Prose: English, no em dashes, sentence-case headings.

## Releases

Maintainers only. Update `CHANGELOG.md`, bump `package.json`, tag `vX.Y.Z`.

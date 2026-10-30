---
name: paseo-plugin-dev
description: Start, verify, test, release and publish Paseo plugins safely. Use when creating a new Paseo plugin, building or debugging one (paseo-plugin.json, index.client.tsx, index.server.ts), running it on an isolated dev daemon or the Paseo web UI, testing agent hooks or timeline cards with a scripted fake agent, testing on an Android phone or iOS simulator, hitting host limits (Hermes, Lucide icons, RPC timeout, safe area, gestures), or releasing and submitting to the Paseo plugin registry.
---

# Paseo plugin development

The plugin API itself (contributions, RPCs, hooks, UI components) lives in getpaseo/paseo's `public-docs/plugins/` and its `skills/paseo-plugin` skill. This skill covers what those leave out: verifying a plugin on real hosts without touching the user's Paseo, the runtime limits nobody documents, and shipping it.

Tooling: the `ppd` CLI from the `paseo-plugin-devkit` npm package. In a plugin repo, install it with `npm install -D paseo-plugin-devkit` and run `npx ppd <command>`. Outside one, run `npx --package paseo-plugin-devkit ppd <command>`: a bare `npx ppd` resolves to an unrelated npm package named `ppd` and fails. `ppd --help` lists commands, `ppd <command> --help` shows options. `examples/hello-plugin` in the package is a minimal plugin that passes every check.

## Start a plugin

1. `npx --package paseo-plugin-devkit ppd create /absolute/path/to/plugin [--template panel|agent-hook]`, then `cd` there and `npm install`. `panel` (default) is a workspace panel, a Command Center item and one RPC. `agent-hook` is `server.on("agent.turn_ended")` appending a timeline card, plus the card renderer and a screen it opens. Done when `npm run check` has 0 FAIL and `npm test` passes; the output does both before any edit.
2. The new package.json depends on the devkit release that created it (`^<version>` from npm). To use an unreleased devkit, pass `--devkit file:<path to a clone>`.
3. What create adds over `paseo plugin init`, so keep it when restructuring: `"node"` in tsconfig `types` (server `node:*` imports fail tsc without it), the `@types/node` ~22 pin (26.x broke installs on Paseo <= 0.11.4, getpaseo/paseo#7145), `.gitignore`, vitest with `test/host-contract.test.ts`. The agent-hook template also pins `@getpaseo/client` and `@getpaseo/protocol` (SDK peer dependencies that type hook events and `PaseoApi`) to the SDK version, so installers that skip peers (yarn v1, `--legacy-peer-deps`) still type them.
4. Timeline renderers get no navigation props. To open a screen or panel from a card, close over the `client` passed to `contribute` (the agent-hook template's `makeSummaryCard(client)` shows it).

## Hard rules

These protect the user's real Paseo. Each has a `ppd` guard; keep them when working by hand too.

- **Isolated daemon only.** Every daemon you start uses a fresh temp home and a port other than 6767. The user's daemon (home `~/.paseo`, port 6767) is never started, stopped, reloaded, configured or targeted. Every manual `paseo` call carries `--home <temp home>`.
- **Plugins stay off on the user's daemon** unless the user enables them. Enable `pluginsEnabled` only in the temp home's `config.json`.
- **Clean up what you started**: `ppd daemon down`, `ppd android down` and removing the phone's host entry, at the end of every run, including failed runs.
- **Phones belong to the user.** Ask before driving one, pin `-s <serial>` on every adb call, check the foreground app first, and send no BACK, HOME or settings changes.
- **Public actions are the user's**: release tags, GitHub releases, registry submissions and PRs. Prepare them; let the user run them (`ppd release`, `ppd registry update --yes`).

## Verification loop

Run in order. Each step ends on its stated observable.

1. **Contract check**: `ppd check <plugin>`. Done when there are 0 FAIL. It compiles and evaluates with the installed Paseo app's own compiler and checks icons against the app's Lucide set. Without the app (Linux, CI) it falls back to an esbuild replica and prints `APPROXIMATION`: say so in your report rather than claiming the real host accepted the plugin. `PASEO_SOURCE=<paseo checkout>` tests against unreleased Paseo instead. A `client-eval` WARN naming `requirements.paseo` means the oldest app the range admits would reject the client (file and agent panels need 0.13.0): raise the range or guard the call.
2. **Dev daemon**: `ppd daemon up --workspace <dir with sample files> --caffeinate`. Done when it prints a URL. It runs detached with a pidfile, so harness time limits do not kill it. Its home is under `$TMPDIR` (on macOS a `/var/folders/...` path, not `/tmp`).
3. **Install**: `ppd install <plugin>` (directory) and `ppd install <plugin> --git` (committed HEAD through the manifest `build`, like a registry install; installed as `<id>-git` next to the directory install). Done when each prints `running` and `client: passes the app's registration rules`, exit 0. `client-rejected` means the app would drop the whole client (an unknown icon, a bad id): fix it before looking at the UI.
4. **Real UI**: `ppd web --shot out/desktop.png --click "<your header button label>"` and `ppd web --viewport 390x844 --shot out/phone.png --command "<your Command Center item>"`. Done when you have looked at both screenshots and `ppd web` exits 0 with `console errors: none` and `plugin evaluation errors: none`. Console errors alone are not enough: the app reports a client that failed to evaluate only as a warning.
5. **Devices**, when the change touches layout, gestures, media or memory: see [references/devices.md](references/devices.md).
6. **Teardown**: `ppd daemon down`. Done when `ppd daemon status` reports no daemon.

**Agent hooks, timeline cards and injected MCP tools**: start the daemon with `ppd daemon up --fake-agent` and drive turns with the credential-free `fake-agent` provider instead of a real agent. A JSON prompt is a script: `ppd paseo -- run --provider fake-agent --cwd <workspace> '{"steps":[{"write":{"path":"a.md","content":"x"}},{"bash":{"command":"npm test"}},{"mcp":{"server":"<injected name>","tool":"<tool>"}},{"say":"done"}]}'`. Steps: `say`, `think`, `write`, `edit`, `bash` (`run: true` executes), `mcp` (`"*"` = every injected server), `sleep`, `fail`. Write and edit carry `detail.filePath` like real adapters. In vitest use `runFakeAgentTurn`, `sendFakeAgentTurn` and `pluginRows(agentTimeline(id), "<kind>")` from `paseo-plugin-devkit` (README, "Fake agent"); `paseo logs` does not show plugin rows. Done when the test asserts the row your hook appended, and a `ppd web` screenshot of the agent shows the card. Do not enable Paseo's mock provider (it needs a dev build and rejects MCP servers).

Iterate with `ppd dev <plugin>`: it installs once, then reloads on every change, re-checks the client and streams plugin logs. Without it, rerun `ppd install <plugin>` (it reloads an installed directory) or use `ppd paseo -- plugin reload <id>` and `ppd paseo -- plugin logs <id>`. A crashed plugin stays down until reloaded.

## References

- [references/host-contract.md](references/host-contract.md): read before writing client UI, gestures, server workers or anything heavy, and whenever something works on web but not on a phone.
- [references/dev-daemon.md](references/dev-daemon.md): the manual daemon recipe, when `ppd` is unavailable or a step fails.
- [references/devices.md](references/devices.md): Android over adb, iOS simulator on Xcode 27.
- [references/registry.md](references/registry.md): releases, first submission, Git updates, OVERVIEW.md rules.
- [references/agent-ops.md](references/agent-ops.md): long or delegated runs (commits, scratch space, sleep, claims).

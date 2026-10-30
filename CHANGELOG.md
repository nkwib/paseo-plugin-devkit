# Changelog

## 0.2.0 (2026-10-30)

- Verified on Paseo 0.12.0: `ppd daemon up` and `ppd doctor` no longer print the version note on it.
- `ppd check` applies the client registration rules of the Paseo version it checks against: the app's or source checkout's version, or without a host the oldest release `requirements.paseo` admits. From 0.13.0 that includes file panels (`client.addFilePanel`, getpaseo/paseo#7411), agent panels (`client.addAgentPanel`), workspace panels without `context`, translated labels, `{ svg }` and component icons, and the `notification` timeline item. Before, every plugin that used them failed `client-eval`.
- On an app version without a method, `client.<method>` is undefined like in the app: a guarded call passes, an unguarded one fails `client-eval`.
- `client-eval` warns when the host accepts the client but the oldest release `requirements.paseo` admits would reject it. `ppd install` and `ppd dev` print the same warning as a note.
- A source checkout's version is raised to the release of the newer client methods its evaluator defines, since its package version lags main until a release is cut.
- When `requirements.paseo` excludes the installed app (a prerelease counts by its stable core, like in Paseo), `client-eval` checks against the range's lower bound and warns that the app would not load the plugin.
- From 0.13.0 a label is a non-empty string or a message from the SDK's `message()`; anything else gets the SDK's error text. `"addFilePanel" in client` works as a guard.
- Docs: React Native, React and SDK versions come from the Paseo app at runtime; how to review their upgrades and keep Dependabot within a React Native series.

## 0.1.0 (2026-10-18)

First public release. Verified on macOS with Paseo 0.11.4.

Dev daemon:

- `ppd daemon up|down|status`: a detached Paseo daemon in a fresh home under `$TMPDIR` on a free port (7800-7899), with plugins and the web UI on and relay, MCP and speech off. Port 6767 and `~/.paseo` are refused, only homes carrying the `.ppd-home` marker are deleted, only pids whose command line carries the dev home are signalled, and inherited `PASEO_*` variables never reach the daemon or CLI calls. `--workspace`, `--fake-agent`, `--caffeinate`, `--port`, `--name`.
- `ppd install [dir]`: installs a plugin, reloads it (same directory) or replaces an installed id, and checks the client against the app's registration rules: a client the app would drop is reported as `client-rejected` (exit 1). `--git` installs committed HEAD through the manifest `build`, also from a repo subfolder.
- `ppd dev [dir]`: install, then reload on every change, re-check the client and stream plugin logs. Pauses when something keeps writing into the plugin folder.
- `ppd paseo -- <args>`: any Paseo CLI call against the dev daemon.
- `ppd web` and the `PaseoWeb` page object (`paseo-plugin-devkit/web`): screenshots at any viewport, Command Center items and clicks by accessible name; reports console errors and plugin clients the app failed to evaluate (exit 1).
- `ppd android up|down|status`: `adb reverse` to the dev daemon, with read-only device checks.
- `ppd doctor`: toolchain report.

Host contract:

- `ppd check`, `paseo-plugin-devkit/testing` and `paseo-plugin-devkit/vitest`: compile and evaluate with the installed Paseo app's own compiler and evaluator (or a `PASEO_SOURCE` checkout), else an esbuild replica labeled `APPROXIMATION` (`--approx` forces it). Plugin code runs in child processes with a time limit, so a hang or `process.exit` fails; the returned cleanup is called and handles left open are warnings. Also: the app's client registration rules, manifest rules from Paseo's schema, Lucide icon names from the app, Hermes class syntax, parse and VM smoke run, bundle sizes, import boundaries, dependency placement and an RPC budget helper.

Agent-facing plugins:

- `ppd daemon up --fake-agent` installs a credential-free provider plugin that runs a scripted turn per prompt. Steps: `say`, `think`, `write`, `edit`, `bash`, `mcp` (calls tools on the MCP servers plugins inject), `sleep`, `fail`. `bash` with `run: true` executes only in a daemon `ppd daemon up` started.
- Library: `runFakeAgentTurn`, `sendFakeAgentTurn`, `agentTimeline` (plugin rows included), `pluginRows`, `fakeAgentPrompt`, `installFakeAgent`.

Start and ship:

- `ppd create <dir> [--template panel|agent-hook]`: wraps `paseo plugin init` (built-in base without it) and adds tsconfig node types, an `@types/node` ~22 pin, `.gitignore`, vitest with a host-contract suite, `npm run check|test|dev` and a README. The result passes `ppd check` and installs as is.
- `ppd registry precheck|update|submit` and `ppd release` (checks the remote before committing and tagging; a rerun after a failed push resumes).
- `examples/hello-plugin`, `examples/ci.yml` and the Claude Code skill `paseo-plugin-dev`.

Compatibility and licensing:

- When the installed Paseo does not look like 0.11.4 (app bundle layout, daemon start, web UI labels), errors name what was expected, the verified and found versions, and the workaround. `ppd doctor` and `ppd daemon up` note a different Paseo version. `ppd --version`.
- Files adapted from Paseo (Apache-2.0) carry per-file notices, and `THIRD_PARTY_NOTICES` ships in the package. The package license is `MIT AND Apache-2.0`.

# Changelog

## Unreleased

Breaking (library API):

- `evaluateClientBundle(bundle, dir, options)` takes an options object (`{ settleMs, icons }`) instead of a positional `settleMs`.
- `installPlugin` is async and returns `action`, `clientErrors` and `clientNotes`; `status` can be `client-rejected`.

Changed:

- Plugin code that `ppd check` runs never sees the caller's `PASEO_*` variables (agent id, CLI, real home), in every compile and evaluation mode.
- The fake agent runs `bash` steps with `run: true` (from a prompt or `.fake-agent.json`) only in a daemon `ppd daemon up` started; anywhere else the step fails the turn without running.
- `ppd web` and status probes use the URL built from the checked port; a state record whose URL disagrees is refused.
- `ppd dev` pauses for 20 s after 8 reloads within 20 s, so a plugin or build writing into its own folder cannot reload forever.
- `ppd check` compiles, evaluates and checks icons with the installed Paseo app (app.asar) by default. Order: `PASEO_SOURCE`, the app (`--paseo-app`, `PASEO_APP`, the app behind `paseo`, `/Applications`), then the esbuild replica, now labeled `APPROXIMATION`. `--approx` forces it.
- Plugin code runs in child processes with a 30 s timeout; a hang, an infinite loop or `process.exit` fails instead of hanging `ppd` or passing. The contribution's cleanup is called and handles left open are warnings.
- Client evaluation applies the app's registration rules (ids, contexts, callbacks, duplicates, icons, cleanup). A violation fails, because the app drops the whole client.
- Manifest rules follow Paseo's schema: `$`-prefixed keys such as `paseo plugin init`'s `$comment` are accepted, `requirements` is strict, `build` must be argv arrays, unknown keys warn.
- Approx-mode drift fixed: lib-boundary imports, compile errors with file:line:col.
- `ppd install` reloads (same directory) or replaces an installed id, checks the client and reports `client-rejected` (exit 1). Defaults to cwd.
- `ppd web` reports plugin clients the app failed to evaluate and exits 1.
- `ppd install --git` and `ppd registry submit|update` support plugins in a repo subfolder.
- `ppd release` checks the remote (origin, tag, `git push --dry-run`) before committing and tagging; a rerun after a failed push resumes.

Added:

- `ppd create <dir> [--template panel|agent-hook]`: wraps `paseo plugin init` (built-in base without it) and adds tsconfig node types, an `@types/node` ~22 pin, `.gitignore`, vitest with a host-contract suite, `npm run check|test|dev` and a README. The output passes `ppd check` and installs as is. `panel` is the hello-plugin panel and RPC; `agent-hook` appends a timeline card on `agent.turn_ended`, with a renderer that opens a screen.
- `ppd daemon up --fake-agent`: installs a credential-free, scripted provider plugin (`assets/fake-agent`) for e2e tests of agent-facing plugins. JSON turn scripts: `say`, `think`, `write`, `edit`, `bash`, `mcp` (calls tools on injected MCP servers), `sleep`, `fail`.
- Library: `createPlugin`, `runFakeAgentTurn`, `sendFakeAgentTurn`, `agentTimeline` (plugin rows included, read through the app's client), `pluginRows`, `fakeAgentPrompt`, `installFakeAgent`.
- `ppd dev [dir]`: install, then reload on every change, re-check the client and stream plugin logs.

Fixed:

- `ppd daemon up`: inherited `PASEO_*` variables (`PASEO_AGENT_ID`, `PASEO_CLI`, ...) no longer reach the dev daemon or CLI calls; an explicit `--paseo` or `--web-dist` that does not exist is an error; a busy port exits 1 (not the safety code 3); a different `--port` for a running daemon is an error; a dead daemon's home is removed.
- `ppd registry precheck`: no crash on malformed media or JSON; a video may come first in `media`.
- `ppd registry update`: rerun with identical content reuses the branch.

## 0.1.0 (unreleased)

First release.

- `ppd daemon up|down|status`, `ppd install`, `ppd paseo --`: isolated dev daemon in a temp home with safety guards (port 6767 and `~/.paseo` are refused, only marked homes are deleted, only pids carrying the dev home are signalled).
- `ppd web`: Playwright page object for the Paseo web UI; screenshots at any viewport, Command Center items and clicks by accessible name.
- `ppd android up|down|status`: `adb reverse` to the dev daemon with read-only device checks.
- `ppd doctor`: toolchain report.
- `ppd check`, `paseo-plugin-devkit/testing` and `/vitest`: host-contract checks (real compiler with `PASEO_SOURCE`, server and client evaluation, host module lists, Hermes, Lucide icons, bundle sizes, RPC budget).
- `ppd registry precheck|update|submit` and `ppd release`.
- `examples/hello-plugin`: a minimal plugin (server RPC plus workspace panel) that passes every check; the test suite uses it.
- Claude Code skill `paseo-plugin-dev`.
- `ppd <command> --help` for every command; bad options point at that help.

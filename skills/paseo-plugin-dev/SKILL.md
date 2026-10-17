---
name: paseo-plugin-dev
description: Verify, test, release and publish Paseo plugins safely. Use when building or debugging a Paseo plugin (paseo-plugin.json, index.client.tsx, index.server.ts), running it on an isolated dev daemon or the Paseo web UI, testing on an Android phone or iOS simulator, hitting host limits (Hermes, Lucide icons, RPC timeout, safe area, gestures), or releasing and submitting to the Paseo plugin registry.
---

# Paseo plugin development

The plugin API itself (contributions, RPCs, hooks, UI components) lives in getpaseo/paseo's `public-docs/plugins/` and its `skills/paseo-plugin` skill. This skill covers what those leave out: verifying a plugin on real hosts without touching the user's Paseo, the runtime limits nobody documents, and shipping it.

Tooling: the `ppd` CLI from `paseo-plugin-devkit`, run as `npx ppd <command>`. It is not on npm: install it as a devDependency with `npm install -D github:nkwib/paseo-plugin-devkit` (needs read access to the repo) or `npm install -D <path to a clone>`. `ppd --help` lists commands, `ppd <command> --help` shows options. `examples/hello-plugin` in the devkit repo is a minimal plugin that passes every check.

## Start a plugin

1. `paseo plugin init /absolute/path/to/plugin && cd /absolute/path/to/plugin && npm install`. Init writes a working plugin (sidebar screen plus one RPC) and a strict tsconfig; it has no daemon options and never touches a daemon. Its `$comment` manifest key is fine.
2. Server code that imports `node:*` needs `"node"` in tsconfig `compilerOptions.types` (init writes only `"react"`), or tsc fails.
3. Init's dev dependencies pull in `@types/node` 26.x. Paseo <= 0.11.4 type-walks installed packages and `@types/node` 26 broke installs (getpaseo/paseo#7145), so add `"@types/node": "~22"` to devDependencies and rerun `npm install`.
4. Add a `.gitignore` with `node_modules/` (init writes none), then the devkit as above.

## Hard rules

These protect the user's real Paseo. Each has a `ppd` guard; keep them when working by hand too.

- **Isolated daemon only.** Every daemon you start uses a fresh temp home and a port other than 6767. The user's daemon (home `~/.paseo`, port 6767) is never started, stopped, reloaded, configured or targeted. Every manual `paseo` call carries `--home <temp home>`.
- **Plugins stay off on the user's daemon** unless the user enables them. Enable `pluginsEnabled` only in the temp home's `config.json`.
- **Clean up what you started**: `ppd daemon down`, `ppd android down` and removing the phone's host entry, at the end of every run, including failed runs.
- **Phones belong to the user.** Ask before driving one, pin `-s <serial>` on every adb call, check the foreground app first, and send no BACK, HOME or settings changes.
- **Public actions are the user's**: release tags, GitHub releases, registry submissions and PRs. Prepare them; let the user run them (`ppd release`, `ppd registry update --yes`).

## Verification loop

Run in order. Each step ends on its stated observable.

1. **Contract check**: `ppd check <plugin>`. Done when there are 0 FAIL. It compiles and evaluates with the installed Paseo app's own compiler and checks icons against the app's Lucide set. Without the app (Linux, CI) it falls back to an esbuild replica and prints `APPROXIMATION`: say so in your report rather than claiming the real host accepted the plugin. `PASEO_SOURCE=<paseo checkout>` tests against unreleased Paseo instead.
2. **Dev daemon**: `ppd daemon up --workspace <dir with sample files> --caffeinate`. Done when it prints a URL. It runs detached with a pidfile, so harness time limits do not kill it. Its home is under `$TMPDIR` (on macOS a `/var/folders/...` path, not `/tmp`).
3. **Install**: `ppd install <plugin>` (directory) and `ppd install <plugin> --git` (committed HEAD through the manifest `build`, like a registry install; installed as `<id>-git` next to the directory install). Done when each prints `running` and `client: passes the app's registration rules`, exit 0. `client-rejected` means the app would drop the whole client (an unknown icon, a bad id): fix it before looking at the UI.
4. **Real UI**: `ppd web --shot out/desktop.png --click "<your header button label>"` and `ppd web --viewport 390x844 --shot out/phone.png --command "<your Command Center item>"`. Done when you have looked at both screenshots and `ppd web` exits 0 with `console errors: none` and `plugin evaluation errors: none`. Console errors alone are not enough: the app reports a client that failed to evaluate only as a warning.
5. **Devices**, when the change touches layout, gestures, media or memory: see [references/devices.md](references/devices.md).
6. **Teardown**: `ppd daemon down`. Done when `ppd daemon status` reports no daemon.

Iterate with `ppd dev <plugin>`: it installs once, then reloads on every change, re-checks the client and streams plugin logs. Without it, rerun `ppd install <plugin>` (it reloads an installed directory) or use `ppd paseo -- plugin reload <id>` and `ppd paseo -- plugin logs <id>`. A crashed plugin stays down until reloaded.

## References

- [references/host-contract.md](references/host-contract.md): read before writing client UI, gestures, server workers or anything heavy, and whenever something works on web but not on a phone.
- [references/dev-daemon.md](references/dev-daemon.md): the manual daemon recipe, when `ppd` is unavailable or a step fails.
- [references/devices.md](references/devices.md): Android over adb, iOS simulator on Xcode 27.
- [references/registry.md](references/registry.md): releases, first submission, Git updates, OVERVIEW.md rules.
- [references/agent-ops.md](references/agent-ops.md): long or delegated runs (commits, scratch space, sleep, claims).

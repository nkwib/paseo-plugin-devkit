---
name: paseo-plugin-dev
description: Verify, test, release and publish Paseo plugins safely. Use when building or debugging a Paseo plugin (paseo-plugin.json, index.client.tsx, index.server.ts), running it on an isolated dev daemon or the Paseo web UI, testing on an Android phone or iOS simulator, hitting host limits (Hermes, Lucide icons, RPC timeout, safe area, gestures), or releasing and submitting to the Paseo plugin registry.
---

# Paseo plugin development

The plugin API itself (contributions, RPCs, hooks, UI components) lives in Paseo's `public-docs/plugins/` and the upstream `paseo-plugin` skill. This skill covers what those leave out: verifying a plugin on real hosts without touching the user's Paseo, the runtime limits nobody documents, and shipping it.

Tooling: the `ppd` CLI from `paseo-plugin-devkit` (a devDependency, run as `npx ppd <command>`). `ppd --help` lists commands, `ppd <command> --help` shows options. `examples/hello-plugin` in the devkit repo is a minimal plugin that passes every check.

## Hard rules

These protect the user's real Paseo. Each has a `ppd` guard; keep them when working by hand too.

- **Isolated daemon only.** Every daemon you start uses a fresh temp home and a port other than 6767. The user's daemon (home `~/.paseo`, port 6767) is never started, stopped, reloaded, configured or targeted. Every manual `paseo` call carries `--home <temp home>`.
- **Plugins stay off on the user's daemon** unless the user enables them. Enable `pluginsEnabled` only in the temp home's `config.json`.
- **Clean up what you started**: `ppd daemon down`, `ppd android down` and removing the phone's host entry, at the end of every run, including failed runs.
- **Phones belong to the user.** Ask before driving one, pin `-s <serial>` on every adb call, check the foreground app first, and send no BACK, HOME or settings changes.
- **Public actions are the user's**: release tags, GitHub releases, registry submissions and PRs. Prepare them; let the user run them (`ppd release`, `ppd registry update --yes`).

## Verification loop

Run in order. Each step ends on its stated observable.

1. **Contract check**: `PASEO_SOURCE=<paseo checkout> ppd check <plugin>`. Done when there are 0 FAIL. Without `PASEO_SOURCE` the real compiler and Lucide checks skip; say so in your report rather than claiming they passed.
2. **Dev daemon**: `ppd daemon up --workspace <dir with sample files> --caffeinate`. Done when it prints a URL. It runs detached with a pidfile, so harness time limits do not kill it.
3. **Install**: `ppd install <plugin>` (directory) and `ppd install <plugin> --git` (committed HEAD through the manifest `build`, like a registry install). Done when each prints `running`.
4. **Real UI**: `ppd web --shot out/desktop.png --click "<your header button label>"` and `ppd web --viewport 390x844 --shot out/phone.png --command "<your Command Center item>"`. Done when you have looked at both screenshots and `console errors: none`.
5. **Devices**, when the change touches layout, gestures, media or memory: see [references/devices.md](references/devices.md).
6. **Teardown**: `ppd daemon down`. Done when `ppd daemon status` reports no daemon.

Iterate with `ppd paseo -- plugin reload <id>` and `ppd paseo -- plugin logs <id>`. A crashed plugin stays down until reloaded.

## References

- [references/host-contract.md](references/host-contract.md): read before writing client UI, gestures, server workers or anything heavy, and whenever something works on web but not on a phone.
- [references/dev-daemon.md](references/dev-daemon.md): the manual daemon recipe, when `ppd` is unavailable or a step fails.
- [references/devices.md](references/devices.md): Android over adb, iOS simulator on Xcode 27.
- [references/registry.md](references/registry.md): releases, first submission, Git updates, OVERVIEW.md rules.
- [references/agent-ops.md](references/agent-ops.md): long or delegated runs (commits, scratch space, sleep, claims).

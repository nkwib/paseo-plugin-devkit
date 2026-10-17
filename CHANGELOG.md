# Changelog

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

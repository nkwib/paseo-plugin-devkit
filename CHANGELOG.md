# Changelog

## 0.1.0

- `ppd daemon up|down|status`, `install`, `paseo --`: isolated dev daemon with safety guards (no port 6767, no `~/.paseo`).
- `ppd web`: Playwright page object for the Paseo web UI, screenshots at any viewport.
- `ppd android up|down|status`: adb reverse with read-only device checks.
- `ppd doctor`: toolchain report.
- `ppd check` and `paseo-plugin-devkit/testing`, `/vitest`: host-contract checks (real compiler with `PASEO_SOURCE`, server eval, client modules, Hermes, Lucide icons, sizes, RPC budget).
- `ppd registry precheck|update|submit`, `ppd release`.
- Claude Code skill `paseo-plugin-dev`.

# paseo-plugin-devkit

Test, verify and ship [Paseo](https://github.com/getpaseo/paseo) plugins without touching your real Paseo.

`ppd` is a CLI, a set of vitest helpers and a Claude Code skill. It covers what the plugin docs leave out: an isolated dev daemon, the web UI in a real browser, Android over adb, the host's undocumented runtime limits, releases and the registry.

## Why

Things that cost days while building a real plugin (a document viewer for PDF, DOCX, XLSX and more):

- A contribution icon with a name the app's Lucide build lacks threw at registration, and the button silently vanished.
- `class` syntax in a bundled dependency passed on web and failed to parse on phones (Hermes).
- An out-of-memory parse crashed the plugin child; Paseo does not respawn it. RPCs time out at 30 s with no abort signal.
- Plugin panels get no safe-area insets and no gesture handler; the Android nav bar covered the last rows.
- Agents testing a plugin came close to restarting the user's own daemon on port 6767.
- A registry submission filed with `gh issue create` got no `submission` label and was ignored. Git listings get no automatic update PRs, and the registry validator falsely fails on macOS temp paths.

Each one is now a check, a guard or a documented step.

## Quick start

Requires Node 22.18+ and the Paseo CLI (the desktop app ships it). Not on npm yet, so install from Git:

```sh
npm install -D github:nkwib/paseo-plugin-devkit
npx ppd doctor                        # what is installed, what is missing

npx ppd check                         # host-contract checks on the plugin in cwd
npx ppd daemon up --workspace ./samples
npx ppd install .
npx ppd web --shot out/desktop.png
npx ppd web --viewport 390x844 --shot out/phone.png
npx ppd daemon down
```

Point `PASEO_SOURCE` at a Paseo checkout (with `npm ci` done) to compile with Paseo's real compiler and check icons against the app's Lucide set.

## Commands

| Command | What it does |
| --- | --- |
| `ppd doctor` | Node, Paseo CLI and version, web UI build, Paseo checkout, browser, Hermes, adb, Xcode, gh, disk, running dev daemons. |
| `ppd daemon up` | Starts a detached daemon in a fresh temp home on a free port (7800-7899), plugins enabled, relay, MCP and speech off, web UI served. `--workspace DIR`, `--caffeinate`, `--port`, `--name`. |
| `ppd daemon down` / `status` | Stops the daemon and removes its home / shows it with installed plugins. |
| `ppd install <dir>` | Installs a plugin into the dev daemon and reports `running` or the logs. `--git` installs committed HEAD through the manifest `build`, like a registry install. |
| `ppd paseo -- <args>` | Any Paseo CLI call against the dev daemon, e.g. `plugin reload <id>`, `plugin logs <id>`. |
| `ppd web` | Opens the web UI in Chrome (Playwright), opens the workspace, prints console errors. `--shot`, `--viewport 390x844`, `--command "<Command Center item>"`, `--click "<aria label>"`, `--path`, `--headed`. |
| `ppd android up\|down\|status` | `adb reverse` to the dev daemon for a phone running the Paseo app. Read-only device checks (lock, screen, foreground app). |
| `ppd check [dir]` | Host-contract checks, below. `--json`, `--max-client-kb`, `--max-server-kb`. |
| `ppd registry precheck` | OVERVIEW.md lint, media and icon paths, lockfile sync, `build` sanity, listing files committed. |
| `ppd registry submit` | Prints the prefilled registry form URL and what to verify after. |
| `ppd registry update --registry <fork>` | Record-edit branch for a Git release in your registry fork, runs the validator, prints push and PR commands. `--yes` runs them. |
| `ppd release <patch\|minor\|major\|X.Y.Z>` | Version bump, changelog section, commit, tag, push, GitHub release. `--dry-run` prints the commands. Interactive only. |

### What `ppd check` verifies

| Check | How |
| --- | --- |
| Compile | Paseo's own `compilePlugin` when `PASEO_SOURCE` is set, otherwise an esbuild replica of its settings. |
| Client modules | Bundle requires only host-provided modules; no gesture handler, reanimated, safe-area or Lucide imports. |
| Server bundle | Requires only host modules and Node built-ins; evaluated like Paseo does (with its evaluator when available); registered RPC handlers listed. |
| Client eval | Factory runs against stub host modules; contributions recorded. |
| Hermes | No class syntax; `hermesc` parse and a smoke run in the Hermes VM when the binaries are found. |
| Icons | Every static contribution icon exists in the app's Lucide set. |
| Size, deps, boundaries | Bundle sizes, runtime deps in `dependencies`, client/server import boundaries, `@types/node` range. |

The same checks are importable:

```ts
// test/host-contract.test.ts
import { fileURLToPath } from "node:url";
import { describeHostContract } from "paseo-plugin-devkit/vitest";

describeHostContract(fileURLToPath(new URL("..", import.meta.url)));
```

```ts
import { assertWithinRpcBudget } from "paseo-plugin-devkit/testing";
await assertWithinRpcBudget(() => handlers.get("doc.render")!(worstCaseInput));  // < 15 s, < 8 MiB
```

`paseo-plugin-devkit/web` exports the `PaseoWeb` page object for your own Playwright tests.

## Safety model

`ppd` is built to run next to your real Paseo and next to coding agents.

- Port 6767 is refused everywhere, and so is any home overlapping `~/.paseo` or a non-temp `PASEO_HOME`.
- Dev homes must sit strictly inside the system temp dir and carry a marker file. Only marked homes are ever deleted.
- Every Paseo CLI call gets `--home <dev home>`; `--host` and `--home` passthrough are rejected.
- `daemon down` signals a pid only if its command line carries that dev home.
- `android` never sends input, never presses BACK or HOME and never changes settings. It refuses to guess between several devices.
- `release` and `registry update` print commands by default; public actions need a TTY confirmation or `--yes`.

Safety violations exit with code 3.

## Claude Code skill

`skills/paseo-plugin-dev` teaches an agent the isolated daemon recipe, the hard rules, the host contract table, device testing (Android, iOS simulator on Xcode 27), registry rules and habits for long runs.

```sh
mkdir -p ~/.claude/skills
cp -R node_modules/paseo-plugin-devkit/skills/paseo-plugin-dev ~/.claude/skills/
```

Or copy it into a plugin repo's `.claude/skills/`.

## CI

[`examples/ci.yml`](examples/ci.yml): tests plus `ppd check` and `ppd registry precheck` on every push, and a weekly job that runs `ppd check` against Paseo main with the latest SDK.

## Limitations

- Client eval and the Hermes smoke run use stub host modules, not the real app. They catch load-time failures, not rendering bugs. Use `ppd web` and a device for those.
- Without `PASEO_SOURCE` the compile is an approximation and icon names are not checked.
- The 32 MiB relay budget comes from field experience, not from Paseo source; direct connections allow 100 MiB.
- `ppd web` needs Google Chrome or a Playwright Chromium matching `playwright-core`.
- There is no iOS command: the simulator build is manual (see the skill). No multi-touch injection for Android.
- macOS and Linux only. Tested on macOS with Paseo 0.11.4.

## Roadmap

Most remaining pain needs Paseo changes. Upstream asks:

- An abort signal for plugin RPC handlers on timeout or disconnect.
- Respawn of crashed plugin children (with backoff).
- A safe-area insets export in the plugin client SDK.
- Registration of plugin horizontal scroll views so swipes do not open the sidebar.
- A previewer hook for the Files tree.
- Prebuilt iOS simulator builds of the app.

Devkit side: npm publish, an iOS simulator command, a fake-host harness for RPC integration tests, a plugin template.

## License

MIT

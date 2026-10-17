#!/usr/bin/env node
// ppd: the Paseo plugin dev kit CLI. Run `ppd --help` for commands.
import { parseArgs, type ParseArgsConfig } from "node:util";
import { resolve } from "node:path";
import { daemonDown, daemonStatus, daemonUp, listDaemons, requireDaemon } from "./daemon.ts";
import { formatInstall, installPlugin } from "./install.ts";
import { runPaseo } from "./paseo.ts";
import { parsePort, SafetyError } from "./safety.ts";
import { UsageError } from "./usage.ts";

const HELP = `ppd: dev kit for Paseo plugin authors

Usage: ppd <command> [options]
       ppd <command> --help      options for one command

Dev daemon (isolated: temp home, never port 6767, never ~/.paseo)
  daemon up|down|status   start, stop or inspect an isolated dev daemon
  install [dir]           install or reload a plugin in the dev daemon
  paseo -- <args...>      run the Paseo CLI against the dev daemon
  web                     open the web UI in Chrome, screenshot, click through
  android up|down|status  adb reverse to the dev daemon (read-only device checks)
  doctor                  toolchain report

Host contract
  check [dir]             compile, evaluate and lint a plugin against the host contract

Release and registry (user-run)
  release <bump>          bump, changelog, tag, push, GitHub release
  registry <sub>          precheck, update or submit a registry listing

Docs: https://github.com/nkwib/paseo-plugin-devkit`;

const COMMAND_HELP: Record<string, string> = {
  daemon: `ppd daemon up [--port N] [--name N] [--workspace DIR] [--web-dist DIR] [--caffeinate] [--paseo BIN]
ppd daemon down [--name N] [--keep-home]
ppd daemon status [--name N] [--json] [--all]

Starts a detached Paseo daemon in a fresh temp home on a free port (7800-7899), with plugins and the web
UI on and relay, MCP and speech off. State lives in ~/.local/state/paseo-plugin-devkit (PPD_STATE_DIR).

  --port N         port to listen on (6767 is refused)
  --name N         run several daemons side by side (default: "default")
  --workspace DIR  create a workspace for DIR after startup
  --web-dist DIR   Paseo web UI build (default: the desktop app's app-dist)
  --caffeinate     keep a Mac awake while the daemon runs
  --paseo BIN      Paseo CLI to use (default: PASEO_BIN, PATH, the desktop app)
  --keep-home      down: keep the temp home for inspection
  --all            status: list every recorded daemon`,
  install: `ppd install [dir] [--git] [--id ID] [--name N]

Installs the plugin in dir (default: cwd) into the dev daemon and prints its status and logs. An id that is
already configured is reloaded (same directory) or replaced, so rerun it after every edit. The client is
checked against the app's registration rules (icons, ids, contexts, cleanup): the app drops a client that
breaks them with only a console warning. Exits 1 unless the plugin is running and its client passes.

  --git     install the committed HEAD through the manifest build, like a registry install
  --id ID   plugin id to install as (default: manifest id, plus "-git" with --git)
  --name N  target dev daemon`,
  paseo: `ppd paseo [--name N] -- <args...>

Runs the Paseo CLI against the dev daemon. --home is always appended; --home and --host are refused.
Example: ppd paseo -- plugin logs hello-plugin`,
  web: `ppd web [--shot FILE] [--viewport WxH] [--command TEXT] [--click LABEL]... [options]

Opens the dev daemon's web UI in Chrome (Playwright), opens the only workspace (or --workspace), runs the
steps in order and prints console errors.

  --shot FILE         save a screenshot
  --viewport WxH      e.g. 390x844; widths under 768 get the compact (phone) layout with touch
  --command TEXT      select a Command Center item by its exact title
  --click LABEL       click an element by its accessible name (repeatable)
  --workspace ID      workspace id, name or path
  --path /route       open an app route instead of a workspace
  --wait MS           settle time before the screenshot (default 1500)
  --full-page         full-page screenshot
  --headed            show the browser
  --name N            target dev daemon`,
  android: `ppd android up|down|status [--serial S] [--name N] [--port N]

up: adb reverse tcp:<port> so a phone running the Paseo app reaches the dev daemon as localhost:<port>.
down: removes the reverse rule. status: device state (screen, lock, foreground app) and reverse rules.
Never sends input or key events and never changes settings. Refuses to guess between several devices.

  --serial S  device serial (required when several are attached)
  --name N    dev daemon whose port to reverse
  --port N    reverse this port instead of a dev daemon's (6767 is refused)`,
  doctor: `ppd doctor [--json]

Reports Node, the Paseo CLI, the web UI build, PASEO_SOURCE, a browser, Hermes, adb, Xcode, git, gh, free
disk and running dev daemons. Read-only. Exits 1 only when something required is missing.`,
  check: `ppd check [dir] [--json] [--paseo-app APP] [--paseo-source DIR] [--approx] [--max-client-kb N] [--max-server-kb N]

Host-contract checks on the plugin in dir (default: cwd): manifest, import boundaries, dependencies,
compile, server and client evaluation (in child processes, 30 s timeout), the app's registration rules,
Hermes, Lucide icon names, bundle size. Exits 1 on any FAIL.

The compiler and icon list come from, in order: --paseo-source / PASEO_SOURCE (a Paseo checkout), the
installed Paseo app (--paseo-app / PASEO_APP, the app behind \`paseo\` on PATH, /Applications/Paseo.app),
else an esbuild approximation, labeled APPROXIMATION in the output.

  --paseo-app APP     Paseo.app to compile with (default: discovered)
  --paseo-source DIR  Paseo checkout with node_modules (default: PASEO_SOURCE); wins over the app
  --approx            force the approximation (what CI without Paseo sees)
  --max-client-kb N   client bundle budget (default 2048)
  --max-server-kb N   server bundle budget (default 32768)
  --json              machine-readable results`,
  release: `ppd release <patch|minor|major|X.Y.Z> [--dry-run] [--yes] [--dir DIR] [--skip-precheck]

Bumps package.json, writes a CHANGELOG.md section (from commits if missing), commits, tags, pushes and
creates a GitHub release. Refuses without a TTY unless --yes.

  --dry-run        print the plan and commands, change nothing
  --yes            skip the confirmation prompt
  --dir DIR        plugin directory (default: cwd)
  --skip-precheck  do not block on registry precheck errors`,
  registry: `ppd registry precheck [dir] [--json]
ppd registry update [dir] --registry DIR [--tag vX.Y.Z] [--id owner/slug] [--yes]
ppd registry submit [dir]

precheck  what the registry reviewer would bounce: OVERVIEW.md lint, media and icon, lockfile, build,
          listing files committed. Exits 1 on errors.
update    record-edit branch in your getpaseo/plugins fork for a Git release, runs the registry validator,
          prints push and PR commands (--yes runs them).
submit    prints the prefilled submission form URL. Submit it in a browser: CLI-created issues miss the
          submission label.`,
};

function wantsHelp(args: string[]): boolean {
  const separator = args.indexOf("--");
  return (separator === -1 ? args : args.slice(0, separator)).some((arg) => arg === "--help" || arg === "-h");
}

type Options = NonNullable<ParseArgsConfig["options"]>;

function parse<T extends Options>(args: string[], options: T) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

const name = { name: { type: "string" } } as const;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command && COMMAND_HELP[command] && wantsHelp(rest)) {
    console.log(COMMAND_HELP[command]);
    return 0;
  }
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      const topic = rest[0];
      console.log(topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] : HELP);
      return 0;
    }
    case "daemon":
      return daemon(rest);
    case "install": {
      const { values, positionals } = parse(rest, { ...name, git: { type: "boolean" }, id: { type: "string" } });
      const result = await installPlugin(resolve(positionals[0] ?? "."), { name: values.name, id: values.id, git: values.git });
      console.log(formatInstall(result));
      return result.status === "running" ? 0 : 1;
    }
    case "paseo": {
      const separator = rest.indexOf("--");
      const flags = separator === -1 ? [] : rest.slice(0, separator);
      const args = separator === -1 ? rest : rest.slice(separator + 1);
      const { values } = parse(flags, name);
      const record = requireDaemon(values.name);
      return runPaseo(record.paseoBin, record.home, args, { inherit: true }).status ?? 1;
    }
    case "web": {
      const { webCommand } = await import("./web.ts");
      return webCommand(rest);
    }
    case "android": {
      const { androidCommand } = await import("./android.ts");
      return androidCommand(rest);
    }
    case "doctor": {
      const { doctorCommand } = await import("./doctor.ts");
      return doctorCommand(rest);
    }
    case "check": {
      const { checkCommand } = await import("./check/index.ts");
      return checkCommand(rest);
    }
    case "release": {
      const { releaseCommand } = await import("./release.ts");
      return releaseCommand(rest);
    }
    case "registry": {
      const { registryCommand } = await import("./registry/index.ts");
      return registryCommand(rest);
    }
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

async function daemon(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "up") {
    const { values } = parse(rest, {
      ...name,
      port: { type: "string" },
      paseo: { type: "string" },
      "web-dist": { type: "string" },
      workspace: { type: "string" },
      caffeinate: { type: "boolean" },
    });
    await daemonUp({
      name: values.name,
      port: values.port ? parsePort(values.port) : undefined,
      paseo: values.paseo,
      webDist: values["web-dist"],
      workspace: values.workspace ? resolve(values.workspace) : undefined,
      caffeinate: values.caffeinate,
    });
    return 0;
  }
  if (sub === "down") {
    const { values } = parse(rest, { ...name, "keep-home": { type: "boolean" } });
    await daemonDown({ name: values.name, keepHome: values["keep-home"] });
    return 0;
  }
  if (sub === "status") {
    const { values } = parse(rest, { ...name, json: { type: "boolean" }, all: { type: "boolean" } });
    if (values.all) {
      for (const record of listDaemons()) console.log(`${record.name}\t${record.url}\tpid ${record.pid}\t${record.home}`);
      return 0;
    }
    const status = await daemonStatus(values.name);
    if (values.json) {
      console.log(JSON.stringify(status, null, 2));
    } else if (!status) {
      console.log(`no dev daemon "${values.name ?? "default"}" recorded`);
    } else {
      const { record } = status;
      console.log(`${record.name}: ${status.live ? "running" : "not running"}${status.live && !status.http ? " (HTTP not answering)" : ""}`);
      console.log(`  url:   ${record.url}\n  home:  ${record.home}\n  pid:   ${record.pid}\n  paseo: ${record.paseoVersion ?? "?"}`);
      if (Array.isArray(status.plugins)) {
        for (const plugin of status.plugins as { id: string; status: string; error?: string }[]) {
          console.log(`  plugin ${plugin.id}: ${plugin.status}${plugin.error ? ` (${plugin.error})` : ""}`);
        }
      }
    }
    return status?.live ? 0 : 1;
  }
  throw new UsageError("ppd daemon up|down|status");
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error & { code?: string }) => {
    const command = process.argv[2];
    const helpHint = command && COMMAND_HELP[command] ? `ppd ${command} --help` : "ppd --help";
    if (error instanceof UsageError) console.error(`${error.message.startsWith("ppd ") ? "usage: " : ""}${error.message}\nrun \`${helpHint}\` for details`);
    else if (error.code?.startsWith("ERR_PARSE_ARGS")) console.error(`${error.message.split(". ")[0]}\nrun \`${helpHint}\` for options`);
    else if (error instanceof SafetyError) console.error(`refused: ${error.message}`);
    else console.error(error.message);
    process.exitCode = error instanceof SafetyError ? 3 : 1;
  },
);

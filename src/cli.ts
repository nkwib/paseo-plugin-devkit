#!/usr/bin/env node
// ppd: the Paseo plugin dev kit CLI. Run `ppd help` for commands.
import { parseArgs, type ParseArgsConfig } from "node:util";
import { resolve } from "node:path";
import { daemonDown, daemonStatus, daemonUp, listDaemons, requireDaemon } from "./daemon.ts";
import { installPlugin } from "./install.ts";
import { runPaseo } from "./paseo.ts";
import { parsePort, SafetyError } from "./safety.ts";

const HELP = `ppd: dev kit for Paseo plugin authors

Usage: ppd <command> [options]

Dev daemon (isolated: temp home, never port 6767, never ~/.paseo)
  daemon up [--port N] [--name N] [--web-dist DIR] [--workspace DIR] [--caffeinate] [--paseo BIN]
  daemon down [--name N] [--keep-home]
  daemon status [--name N] [--json]
  install <dir> [--git] [--id ID] [--name N]   install a plugin into the dev daemon
  paseo -- <args...>                          run the Paseo CLI against the dev daemon
  web [--shot FILE] [--viewport WxH] [--path /route] [--headed] [--name N]
  android up|down [--serial S] [--name N]     adb reverse to the dev daemon (never changes device settings)
  doctor [--json]                             toolchain report

Host contract
  check [dir] [--json] [--paseo-source DIR] [--max-client-kb N] [--max-server-kb N]

Release and registry (user-run)
  release <patch|minor|major|X.Y.Z> [--dry-run] [--yes]
  registry precheck [dir] [--json]
  registry update [dir] --registry DIR [--tag vX.Y.Z] [--id owner/slug] [--yes]
  registry submit [dir]                       print the prefilled submission form URL

Docs: https://github.com/nkwib/paseo-plugin-devkit`;

type Options = NonNullable<ParseArgsConfig["options"]>;

function parse<T extends Options>(args: string[], options: T) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

const name = { name: { type: "string" } } as const;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "daemon":
      return daemon(rest);
    case "install": {
      const { values, positionals } = parse(rest, { ...name, git: { type: "boolean" }, id: { type: "string" } });
      const dir = positionals[0];
      if (!dir) throw new UsageError("ppd install <dir>");
      const result = installPlugin(resolve(dir), { name: values.name, id: values.id, git: values.git });
      console.log(`${result.id}: ${result.status}${result.error ? `\n${result.error}` : ""}`);
      if (result.logs.trim()) console.log(`--- plugin logs\n${result.logs.trim()}`);
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

class UsageError extends Error {}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    if (error instanceof UsageError) console.error(`usage: ${error.message}\nrun \`ppd help\` for commands`);
    else if (error instanceof SafetyError) console.error(`refused: ${error.message}`);
    else console.error(error.message);
    process.exitCode = error instanceof SafetyError ? 3 : 1;
  },
);

export { UsageError };

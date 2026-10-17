// `ppd android up|down|status`: connect a phone to the dev daemon through `adb reverse`.
// Read-only device checks only: no key events, no settings changes, no BACK or HOME.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { requireDaemon } from "./daemon.ts";
import { run, which } from "./proc.ts";

export const PASEO_ANDROID_PACKAGE = "sh.paseo";

export interface AdbDevice {
  serial: string;
  state: string;
  description: string;
}

export function findAdb(env: NodeJS.ProcessEnv = process.env): string | null {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const candidates = [
    env.PPD_ADB,
    sdk ? join(sdk, "platform-tools/adb") : null,
    join(homedir(), "Library/Android/sdk/platform-tools/adb"),
    join(homedir(), "Android/Sdk/platform-tools/adb"),
  ];
  return candidates.find((path): path is string => Boolean(path) && existsSync(path!)) ?? which("adb", env);
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = "", state = "", ...rest] = line.split(/\s+/);
      return { serial, state, description: rest.join(" ") };
    });
}

/** One usable device: the requested serial, or the only attached device. Never guesses between several. */
export function selectDevice(devices: AdbDevice[], serial?: string): AdbDevice {
  const usable = devices.filter((device) => device.state === "device");
  if (serial) {
    const found = devices.find((device) => device.serial === serial);
    if (!found) throw new Error(`device ${serial} is not attached; attached: ${devices.map((d) => d.serial).join(", ") || "none"}`);
    if (found.state !== "device") throw new Error(`device ${serial} is ${found.state}; authorize it on the phone first`);
    return found;
  }
  if (usable.length === 1) return usable[0]!;
  if (usable.length === 0) {
    const pending = devices.map((d) => `${d.serial} (${d.state})`).join(", ");
    throw new Error(`no authorized Android device${pending ? `: ${pending}` : ""}`);
  }
  throw new Error(`several devices attached, pass --serial: ${usable.map((d) => `${d.serial} ${d.description}`.trim()).join("; ")}`);
}

export interface DeviceState {
  awake: boolean | null;
  locked: boolean | null;
  paseoInstalled: boolean | null;
  foreground: string | null;
}

export function parseWakefulness(dumpsysPower: string): boolean | null {
  const match = /mWakefulness=(\w+)/.exec(dumpsysPower);
  return match ? match[1] === "Awake" : null;
}

export function parseLocked(dumpsysWindow: string): boolean | null {
  const keyguard = /(?:mShowingLockscreen|isKeyguardShowing|mDreamingLockscreen|KeyguardShowing)=(true|false)/i.exec(dumpsysWindow);
  return keyguard ? keyguard[1] === "true" : null;
}

export function parseForeground(dumpsysActivity: string): string | null {
  const match = /(?:topResumedActivity|mResumedActivity|ResumedActivity)[^{]*\{[^}]*?\s([\w.]+)\/[\w.$]+/.exec(dumpsysActivity);
  return match?.[1] ?? null;
}

function adb(bin: string, serial: string, args: string[]): string {
  const result = run(bin, ["-s", serial, ...args], { timeout: 30_000 });
  return result.status === 0 ? result.stdout : "";
}

export function readDeviceState(bin: string, serial: string): DeviceState {
  const power = adb(bin, serial, ["shell", "dumpsys", "power"]);
  const window = adb(bin, serial, ["shell", "dumpsys", "window"]);
  const activity = adb(bin, serial, ["shell", "dumpsys", "activity", "activities"]);
  const packages = adb(bin, serial, ["shell", "pm", "list", "packages", PASEO_ANDROID_PACKAGE]);
  return {
    awake: power ? parseWakefulness(power) : null,
    locked: window ? parseLocked(window) : null,
    paseoInstalled: packages ? packages.split("\n").some((line) => line.trim() === `package:${PASEO_ANDROID_PACKAGE}`) : null,
    foreground: activity ? parseForeground(activity) : null,
  };
}

export function deviceWarnings(state: DeviceState): string[] {
  const warnings: string[] = [];
  if (state.awake === false) warnings.push("screen is off: ask the user to wake and unlock the phone (ppd never sends key events)");
  if (state.locked === true) warnings.push("phone is locked: ask the user to unlock it");
  if (state.paseoInstalled === false) warnings.push(`Paseo app (${PASEO_ANDROID_PACKAGE}) is not installed`);
  if (state.foreground && state.foreground !== PASEO_ANDROID_PACKAGE) {
    warnings.push(`foreground app is ${state.foreground}: the user may be using the phone; do not inject input until Paseo is in front`);
  }
  return warnings;
}

export async function androidCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const { values } = parseArgs({
    args: rest,
    options: { serial: { type: "string" }, name: { type: "string" }, port: { type: "string" } },
    strict: true,
  });
  if (sub !== "up" && sub !== "down" && sub !== "status") throw new Error("usage: ppd android up|down|status [--serial S]");
  const bin = findAdb();
  if (!bin) throw new Error("adb not found: install Android platform-tools or set PPD_ADB");
  const devices = parseAdbDevices(run(bin, ["devices", "-l"], { timeout: 30_000 }).stdout);
  const device = selectDevice(devices, values.serial);
  const port = values.port ? Number(values.port) : requireDaemon(values.name).port;
  const spec = `tcp:${port}`;
  console.log(`device: ${device.serial} ${device.description}`.trim());

  if (sub === "down") {
    const removed = run(bin, ["-s", device.serial, "reverse", "--remove", spec], { timeout: 30_000 });
    console.log(removed.status === 0 ? `removed adb reverse ${spec}` : `no adb reverse for ${spec}`);
    console.log(`cleanup checklist:
  - in the Paseo app, remove the host localhost:${port} (Settings > Hosts)
  - leave the phone as you found it: no settings were changed by ppd`);
    return 0;
  }

  const state = readDeviceState(bin, device.serial);
  const warnings = deviceWarnings(state);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  if (sub === "status") {
    console.log(JSON.stringify(state, null, 2));
    console.log(run(bin, ["-s", device.serial, "reverse", "--list"], { timeout: 30_000 }).stdout.trim() || "no adb reverse rules");
    return warnings.length ? 1 : 0;
  }

  const reverse = run(bin, ["-s", device.serial, "reverse", spec, spec], { timeout: 30_000 });
  if (reverse.status !== 0) throw new Error(`adb reverse failed: ${reverse.stderr.trim()}`);
  console.log(`adb reverse ${spec} -> dev daemon on 127.0.0.1:${port}
next:
  1. ask the user to open Paseo on the phone and add the host localhost:${port}
  2. install or reload the plugin with ppd, then open its surface on the phone
  3. screenshots: ${bin} -s ${device.serial} exec-out screencap -p > shot.png
  4. when done: ppd android down${values.serial ? ` --serial ${values.serial}` : ""}, then remove the host in the app
rules: pin -s ${device.serial} on every adb call, never send BACK or HOME, check the foreground app before any input`);
  return 0;
}

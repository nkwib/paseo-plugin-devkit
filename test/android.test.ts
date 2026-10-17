import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { deviceWarnings, parseAdbDevices, parseForeground, parseLocked, parseWakefulness, selectDevice } from "../src/android.ts";
import { CLI, scratch } from "./helpers.ts";

const DEVICES = `List of devices attached
39101FDJH00ABC         device usb:1-1 product:mustang model:Pixel_10_Pro device:mustang transport_id:3
adb-39101FDJH00ABC-xyz._adb-tls-connect._tcp device product:mustang model:Pixel_10_Pro transport_id:4
emulator-5554          unauthorized transport_id:5
`;

describe("device selection", () => {
  it("parses adb devices -l", () => {
    const devices = parseAdbDevices(DEVICES);
    expect(devices.map((d) => [d.serial, d.state])).toEqual([
      ["39101FDJH00ABC", "device"],
      ["adb-39101FDJH00ABC-xyz._adb-tls-connect._tcp", "device"],
      ["emulator-5554", "unauthorized"],
    ]);
  });

  it("refuses to guess between several devices (USB plus wireless entry)", () => {
    expect(() => selectDevice(parseAdbDevices(DEVICES))).toThrow(/several devices attached, pass --serial/);
  });

  it("picks the requested serial and rejects unauthorized or missing ones", () => {
    const devices = parseAdbDevices(DEVICES);
    expect(selectDevice(devices, "39101FDJH00ABC").serial).toBe("39101FDJH00ABC");
    expect(() => selectDevice(devices, "emulator-5554")).toThrow(/unauthorized/);
    expect(() => selectDevice(devices, "nope")).toThrow(/not attached/);
  });

  it("uses the only authorized device", () => {
    expect(selectDevice(parseAdbDevices("List of devices attached\nabc device\n")).serial).toBe("abc");
    expect(() => selectDevice([])).toThrow(/no authorized/);
  });
});

describe("device state", () => {
  it("reads wakefulness, keyguard and foreground app", () => {
    expect(parseWakefulness("  mWakefulness=Asleep\n")).toBe(false);
    expect(parseWakefulness("mWakefulness=Awake")).toBe(true);
    expect(parseLocked("    mShowingLockscreen=true mShowingDream=false")).toBe(true);
    expect(parseLocked("isKeyguardShowing=false")).toBe(false);
    expect(parseForeground("  topResumedActivity=ActivityRecord{4b1 u0 sh.paseo/.MainActivity t12}")).toBe("sh.paseo");
    expect(parseForeground("    mResumedActivity: ActivityRecord{9f u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t1}")).toBe("com.google.android.apps.nexuslauncher");
  });

  it("warns instead of acting when the phone is locked or in use", () => {
    const warnings = deviceWarnings({ awake: false, locked: true, paseoInstalled: true, foreground: "com.android.chrome" });
    expect(warnings.join("\n")).toMatch(/screen is off/);
    expect(warnings.join("\n")).toMatch(/locked/);
    expect(warnings.join("\n")).toMatch(/may be using the phone/);
    expect(deviceWarnings({ awake: true, locked: false, paseoInstalled: true, foreground: "sh.paseo" })).toEqual([]);
  });
});

describe("ppd android with a fake adb", () => {
  function fakeAdb(devices: string) {
    const dir = scratch("ppd-adb-");
    const log = join(dir, "calls.log");
    const bin = join(dir, "adb");
    writeFileSync(
      bin,
      `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  "devices -l") printf '${devices}' ;;
  *"dumpsys power"*) echo "mWakefulness=Awake" ;;
  *"dumpsys window"*) echo "mShowingLockscreen=false" ;;
  *"dumpsys activity"*) echo "topResumedActivity=ActivityRecord{1 u0 sh.paseo/.MainActivity t1}" ;;
  *"pm list packages"*) echo "package:sh.paseo" ;;
esac
exit 0
`,
    );
    chmodSync(bin, 0o755);
    return { bin, log };
  }

  it("pins -s, only reads state and reverses the port; never sends input", () => {
    const adb = fakeAdb("List of devices attached\\nSERIAL1 device model:Pixel\\nSERIAL2 device model:Other\\n");
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "android", ...args], { encoding: "utf8", env: { ...process.env, PPD_ADB: adb.bin } });
    const ambiguous = run("up", "--port", "7811");
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stderr).toMatch(/several devices/);

    const up = run("up", "--port", "7811", "--serial", "SERIAL2");
    expect(up.status).toBe(0);
    expect(up.stdout).toMatch(/add the host localhost:7811/);
    const down = run("down", "--port", "7811", "--serial", "SERIAL2");
    expect(down.status).toBe(0);

    const calls = readFileSync(adb.log, "utf8").trim().split("\n");
    for (const call of calls.filter((c) => c !== "devices -l")) expect(call.startsWith("-s SERIAL2 ")).toBe(true);
    expect(calls).toContain("-s SERIAL2 reverse tcp:7811 tcp:7811");
    expect(calls).toContain("-s SERIAL2 reverse --remove tcp:7811");
    expect(calls.some((c) => / input | settings | svc |keyevent|wm /.test(` ${c} `))).toBe(false);
  });
});

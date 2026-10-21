// When the installed Paseo does not look like the verified release, ppd says so (what it expected, which
// version it found, how to get around it) instead of blaming the plugin. These run anywhere: a fake app layout
// with plain Node as the "helper" stands in for Paseo.app.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PLUGINS, compileWithHost, type PaseoHost } from "../src/check/compile.ts";
import { iconListProblem } from "../src/check/lucide.ts";
import { ISSUES_URL, layoutMismatch, VERIFIED_PASEO, versionNote } from "../src/compat.ts";
import { EXAMPLE, ROOT, scratch } from "./helpers.ts";

function fakeApp(version: string): Extract<PaseoHost, { kind: "app" }> {
  const app = join(scratch("ppd-fake-app-"), "Paseo.app");
  const resources = join(app, "Contents/Resources");
  mkdirSync(join(resources, "app.asar"), { recursive: true });
  return { kind: "app", app, resources, helper: process.execPath, version };
}

describe("layout mismatch messages", () => {
  it("name what was expected, the verified and found versions, and where to report", () => {
    const message = layoutMismatch("could not do X", "a file at Y", "0.13.0", "Use Z");
    expect(message).toContain("could not do X: expected a file at Y.");
    expect(message).toContain(`verified on Paseo ${VERIFIED_PASEO} and found 0.13.0`);
    expect(message).toContain("Use Z.");
    expect(message).toContain(ISSUES_URL);
    expect(layoutMismatch("p", "e", VERIFIED_PASEO, "n")).toContain("the install may be incomplete");
  });

  it("flag a Paseo version other than the verified one", () => {
    expect(versionNote(VERIFIED_PASEO)).toBeNull();
    expect(versionNote(null)).toBeNull();
    expect(versionNote("0.13.0")).toBe(`ppd was verified on Paseo ${VERIFIED_PASEO}; this is 0.13.0`);
    expect(versionNote("paseo 0.13.1-beta.2\n")).toContain("this is 0.13.1-beta.2");
  });
});

describe("an app whose bundle layout differs", () => {
  it("fails the real compile as a host problem with the way around it", async () => {
    const result = await compileWithHost(EXAMPLE, fakeApp("0.13.0"), 30_000);
    expect(result.stage).toBe("load");
    const [first, ...rest] = result.error!.split("\n");
    expect(first).toContain("could not load Paseo's plugin compiler from the Paseo 0.13.0 app");
    expect(first).toContain(APP_PLUGINS);
    expect(first).toContain("ppd check --approx");
    expect(first).toContain(`verified on Paseo ${VERIFIED_PASEO} and found 0.13.0`);
    expect(rest.join("\n")).toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/);
  });

  it("treats modules that no longer export the compiler API as a load failure", async () => {
    const host = fakeApp("0.13.0");
    const plugins = join(host.resources, APP_PLUGINS);
    mkdirSync(plugins, { recursive: true });
    for (const name of ["compiler", "bundle-evaluator", "manifest"]) writeFileSync(join(plugins, `${name}.js`), "export const renamed = 1;\n");
    writeFileSync(join(host.resources, "app.asar/node_modules/@getpaseo/server/package.json"), '{ "type": "module" }\n');
    const result = await compileWithHost(EXAMPLE, host, 30_000);
    expect(result.stage).toBe("load");
    expect(result.error).toContain("could not load Paseo's plugin compiler");
    expect(result.error).toContain("do not export readPluginManifest, compilePlugin, evaluateBundle");
  });

  it("says why the app's icon list is not used", () => {
    const host = fakeApp("0.13.0");
    const missing = iconListProblem(host, null)!;
    expect(missing).toContain("could not read the Lucide icon list of the Paseo 0.13.0 app");
    expect(missing).toContain("Icon names are not checked");
    expect(iconListProblem(host, { exact: false })).toContain("plugin's own lucide-react-native instead");
    expect(iconListProblem(host, { exact: true })).toBeNull();
    expect(iconListProblem(null, null)).toBeNull();
  });

  it("reports a missing timeline client with a ppd-layout line", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/host-timeline.mjs"), scratch("ppd-no-client-"), "ws://127.0.0.1:9/ws", "agent"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^ppd-layout: cannot import @getpaseo\/client\/dist\/daemon-client\.js/m);
  });
});

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWithinRpcBudget, measureRpc } from "../src/check/budget.ts";
import { bundleRequires, disallowedClientRequires, disallowedServerRequires, evaluateClientBundle, evaluateServerBundle } from "../src/check/bundle.ts";
import { compileLikePaseo, findPaseoApp, findPaseoSource } from "../src/check/compile.ts";
import { classSyntaxErrors, findHermes, hermesParse, hermesSmoke } from "../src/check/hermes.ts";
import { runChecks } from "../src/check/index.ts";
import { appIconNames, parseBundleIconNames, parseLucideNames, staticIconNames } from "../src/check/lucide.ts";
import { EXAMPLE, FIXTURES } from "./helpers.ts";

const GOOD = EXAMPLE;
const BAD = join(FIXTURES, "bad-plugin");
const PASEO_SOURCE = findPaseoSource();
const PASEO_APP = findPaseoApp();
const HERMES = findHermes(GOOD);

describe("bundle requires", () => {
  it("lists runtime requires and flags modules outside the host lists", () => {
    const bundle = 'var a = require("react"); var b = require("react-native-gesture-handler"); var c = require("node:fs"); var d = require("zod");';
    expect(bundleRequires(bundle)).toEqual(["node:fs", "react", "react-native-gesture-handler", "zod"]);
    expect(disallowedClientRequires(bundle)).toEqual(["node:fs", "react-native-gesture-handler"]);
    expect(disallowedServerRequires(bundle)).toEqual(["react", "react-native-gesture-handler"]);
  });
});

describe("compiled fixtures", () => {
  it("evaluates the good server bundle and registers its RPC", async () => {
    const evaluation = evaluateServerBundle(await compileLikePaseo(join(GOOD, "index.server.ts"), "server"), GOOD);
    expect([...evaluation.handlers.keys()]).toEqual(["hello.greet"]);
    expect(await evaluation.handlers.get("hello.greet")!({ name: "you" }, {})).toMatchObject({ text: expect.stringMatching(/^Hello, you!/), count: 1 });
  });

  it("records client contributions and their icons under stub host modules", async () => {
    const evaluation = await evaluateClientBundle(await compileLikePaseo(join(GOOD, "index.client.tsx"), "client"), GOOD);
    expect(evaluation.contributions.map((c) => c.method)).toEqual(["addWorkspacePanel", "addCommandCenterItem"]);
    expect(evaluation.icons).toEqual(["Hand", "MessageCircle"]);
    expect(evaluation.setupError).toBeNull();
  });

  it("applies the app's registration rules: unknown icons, ids and missing cleanup are contract errors", async () => {
    const good = await evaluateClientBundle(await compileLikePaseo(join(GOOD, "index.client.tsx"), "client"), GOOD, { icons: new Set(["Hand", "MessageCircle"]) });
    expect(good.contractErrors).toEqual([]);
    const bundle = `(function(require) { const m = { exports: {} }; m.exports.default = function (client) {
      client.addWorkspacePanel({ id: "Bad_Id", title: "x", icon: "HandWave", context: "workspace", Component: function () {} });
      client.addSidebarWidget({ id: "w" });
    }; return m.exports; })`;
    const bad = await evaluateClientBundle(bundle, GOOD, { icons: new Set(["Hand"]) });
    expect(bad.contractErrors).toEqual([
      "Invalid workspace panel id: Bad_Id",
      "client.addSidebarWidget is not part of the app's plugin client context (calling it throws)",
      "Plugin contribution must return a cleanup function",
    ]);
    const icon = await evaluateClientBundle(bundle.replace("Bad_Id", "panel"), GOOD, { icons: new Set(["Hand"]) });
    expect(icon.contractErrors).toContain("Unknown Lucide icon: HandWave");
  });

  it("throws the app's error for a module the host does not provide", async () => {
    const bundle = '(function(require) { const m = { exports: {} }; require("react-native-svg"); m.exports.default = function () {}; return m.exports; })';
    await expect(evaluateClientBundle(bundle, GOOD)).rejects.toThrow('Module "react-native-svg" is not available in plugin client code');
  });

  it("finds class syntax that Hermes rejects", async () => {
    expect(await classSyntaxErrors(await compileLikePaseo(join(GOOD, "index.client.tsx"), "client"))).toEqual([]);
    expect((await classSyntaxErrors(await compileLikePaseo(join(BAD, "index.client.tsx"), "client"))).length).toBeGreaterThan(0);
  });
});

describe("runChecks", () => {
  it("passes the example plugin on the approximation and labels it as such", async () => {
    const results = await runChecks(GOOD, { paseoSource: null, paseoApp: null });
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
    expect(results.find((r) => r.id === "paseo-compile")).toMatchObject({ status: "skip", message: expect.stringMatching(/^APPROXIMATION: .*PASEO_APP.*PASEO_SOURCE/) });
    expect(results.find((r) => r.id === "approx-compile")?.message).toMatch(/^approximation:/);
  });

  it.skipIf(!PASEO_APP)("compiles with the installed Paseo app and checks icons against its exact set (macOS with Paseo.app)", async () => {
    const good = await runChecks(GOOD, { paseoSource: null });
    expect(good.filter((r) => r.status === "fail")).toEqual([]);
    expect(good.find((r) => r.id === "paseo-compile")?.message).toMatch(/Paseo [\d.]+ app/);
    expect(good.find((r) => r.id === "approx-compile")).toBeUndefined();
    expect(good.find((r) => r.id === "lucide-icons")).toMatchObject({ status: "pass", message: expect.stringMatching(/\d{4} Lucide icons of the Paseo/) });
    const bad = await runChecks(BAD, { paseoSource: null });
    expect(bad.find((r) => r.id === "lucide-icons")).toMatchObject({ status: "fail", message: expect.stringContaining("NotARealIconName") });
    expect(bad.find((r) => r.id === "client-eval")?.details).toContain("Unknown Lucide icon: NotARealIconName");
  }, 120_000);

  it("fails the bad fixture on boundaries, server evaluation and class syntax", async () => {
    const results = await runChecks(BAD, { paseoSource: null });
    const failed = results.filter((r) => r.status === "fail").map((r) => r.id);
    expect(failed).toEqual(expect.arrayContaining(["imports", "server-eval", "hermes-class"]));
    const imports = results.find((r) => r.id === "imports")!;
    expect(imports.details!.join("\n")).toMatch(/node:fs: Node modules are server-only/);
    expect(imports.details!.join("\n")).toMatch(/react-native-gesture-handler: no gesture-handler/);
    expect(imports.details!.join("\n")).toMatch(/server\/react-leak.ts imports react: React is client-only/);
  });

  it("warns when a bundle is over budget", async () => {
    const results = await runChecks(GOOD, { paseoSource: null, maxClientBytes: 10 });
    expect(results.find((r) => r.id === "bundle-size")?.status).toBe("warn");
  });

  it.skipIf(!PASEO_SOURCE)("compiles with Paseo's real compiler and validates Lucide names (needs PASEO_SOURCE)", async () => {
    const good = await runChecks(GOOD, { paseoSource: PASEO_SOURCE });
    expect(good.find((r) => r.id === "paseo-compile")?.status).toBe("pass");
    expect(good.find((r) => r.id === "lucide-icons")?.status).toBe("pass");
    const bad = await runChecks(BAD, { paseoSource: PASEO_SOURCE });
    expect(bad.find((r) => r.id === "lucide-icons")).toMatchObject({ status: "fail", message: expect.stringContaining("NotARealIconName") });
  }, 300_000);
});

describe("Hermes", () => {
  it.skipIf(!HERMES.hermesc)("hermesc rejects the class fixture and accepts the good one", async () => {
    expect(hermesParse(HERMES.hermesc!, await compileLikePaseo(join(GOOD, "index.client.tsx"), "client")).ok).toBe(true);
    expect(hermesParse(HERMES.hermesc!, await compileLikePaseo(join(BAD, "index.client.tsx"), "client")).ok).toBe(false);
  });

  it.skipIf(!HERMES.hermes)("the Hermes VM runs the good contribution and reports its icons", async () => {
    const smoke = hermesSmoke(HERMES.hermes!, await compileLikePaseo(join(GOOD, "index.client.tsx"), "client"));
    expect(smoke).toMatchObject({ ok: true, registered: ["addWorkspacePanel", "addCommandCenterItem"], icons: ["Hand", "MessageCircle"] });
  });
});

describe("Lucide names", () => {
  it("parses exported names and aliases from the type declarations", () => {
    const names = parseLucideNames("declare const FileText: LucideIcon;\ndeclare const Hand: LucideIcon;\nexport { FileText, FileText as FileTextIcon, Hand };\n");
    expect([...names].sort()).toEqual(["FileText", "FileTextIcon", "Hand"]);
  });

  it("reads icon names from the app's Metro web bundle, without Icon", () => {
    const bundle = '__d(function(g,r,i,a,m,e,d){Object.defineProperty(f,"AArrowDown",{enumerable:!0,get:function(){return g.default}}),Object.defineProperty(f,"ArrowLeft",{enumerable:!0,get:function(){return $t.default}}),Object.defineProperty(f,"Icon",{enumerable:!0,get:function(){return pne.default}}),Object.defineProperty(f,"LucideProvider",{enumerable:!0,get:function(){return b.LucideProvider}})},1);__d(function(){},2)';
    expect([...parseBundleIconNames(bundle)].sort()).toEqual(["AArrowDown", "ArrowLeft"]);
  });

  it.skipIf(!PASEO_APP)("reads the installed app's icon set", () => {
    const icons = appIconNames(PASEO_APP!.resources)!;
    expect(icons.names.size).toBeGreaterThan(5000);
    expect(icons.names.has("Hand")).toBe(true);
    expect(icons.names.has("HandWave")).toBe(false);
    expect(icons.names.has("Icon")).toBe(false);
  });

  it("finds icon literals in client source", () => {
    expect(staticIconNames(`{ icon: "FileText" } <Button icon="Search" /> <Icon name={"ZoomIn"} size={4} />`).sort()).toEqual(["FileText", "Search", "ZoomIn"]);
  });
});

describe("RPC budget", () => {
  it("measures time and bytes against the 30 s host timeout", async () => {
    const result = await measureRpc(() => ({ ok: true }), { timeFraction: 0.5 });
    expect(result).toMatchObject({ withinTime: true, withinBytes: true, limitMs: 15_000 });
  });

  it("throws when a response or duration is over budget", async () => {
    await expect(assertWithinRpcBudget(() => "x".repeat(100), { maxBytes: 10 })).rejects.toThrow(/response is 102 bytes/);
    await expect(assertWithinRpcBudget(() => new Promise((resolve) => setTimeout(() => resolve(1), 30)), { timeoutMs: 20, timeFraction: 1 })).rejects.toThrow(/took \d+ ms/);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateClientBundle } from "../src/check/bundle.ts";
import { ClientRules } from "../src/check/client-rules.ts";
import { paseoHostVersion } from "../src/check/compile.ts";
import { checkClient, runChecks } from "../src/check/index.ts";
import { EXAMPLE, scratch } from "./helpers.ts";

const icons = new Set(["FileText"]);
const Component = () => null;
const filePanel = (patch: Record<string, unknown> = {}) => ({ id: "pdf", title: "PDF", icon: "FileText", files: { extensions: ["pdf"] }, Component, ...patch });
const message = { translation: "title" };
const errors = (version: string, ...calls: [string, Record<string, unknown>][]) => {
  const rules = new ClientRules(icons, version, (value) => value === message);
  for (const [method, contribution] of calls) rules.register(method, [contribution]);
  return rules.errors;
};
const fileCall = 'client.addFilePanel({ id: "pdf", title: "PDF", icon: "FileText", files: { extensions: ["pdf"] }, Component: function () {} })';
const bundle = (body: string) => `(function(require) { return { default: function(client) { ${body}; return function() {}; } }; })`;

describe("client contract by Paseo version (evaluate.ts at v0.12.0 and v0.13.0)", () => {
  it.each(["0.13.0", "0.13.0-beta.2", "0.14.0"])("accepts 0.13 panels, labels and icons on %s", (version) => {
    expect(
      errors(
        version,
        ["addFilePanel", filePanel()],
        ["addFilePanel", filePanel({ id: "svg", icon: { svg: '<svg><use href="#a"/></svg>' } })],
        ["addFilePanel", filePanel({ id: "drawn", icon: Component })],
        ["addAgentPanel", { id: "agent", title: "Agent", icon: "FileText", Component }],
        ["addWorkspacePanel", { id: "flat", title: message, icon: "FileText", Component }],
        ["addCommandCenterItem", { id: "open", title: "Open", icon: { svg: "<svg></svg>" }, context: "global", onSelect: Component }],
        ["addTimelineTransformer", { id: "notes", query: { itemType: "notification" }, transform: Component }],
      ),
    ).toEqual([]);
  });

  it("applies the 0.12 rules to the same registrations on 0.12.0", () => {
    expect(
      errors(
        "0.12.0",
        ["addWorkspacePanel", { id: "flat", title: message, icon: { svg: "<svg></svg>" }, Component }],
        ["addTimelineTransformer", { id: "notes", query: { itemType: "notification" }, transform: Component }],
        ["addWorkspacePanel", { id: "named", title: "Named", icon: "Nope", context: "workspace", Component }],
      ),
    ).toEqual([
      "Workspace panel flat has no title",
      "Workspace panel flat has no icon",
      "Workspace panel flat has invalid context",
      "Timeline transformer notes has invalid item type: notification",
      "Unknown Lucide icon: Nope",
    ]);
  });

  it("has file panels, labels and icons but not agent or context-free panels on 0.13.0-beta.1", () => {
    const rules = new ClientRules(icons, "0.13.0-beta.1", (value) => value === message);
    expect([rules.has("addFilePanel"), rules.has("addAgentPanel")]).toEqual([true, false]);
    rules.register("addFilePanel", [filePanel({ title: message, icon: { svg: "<svg></svg>" } })]);
    rules.register("addWorkspacePanel", [{ id: "flat", title: "Flat", icon: "FileText", Component }]);
    expect(rules.errors).toEqual(["Workspace panel flat has invalid context"]);
  });

  it("takes only SDK messages as labels, with the SDK's error for anything else", () => {
    expect(
      errors(
        "0.14.0",
        ["addSettingsScreen", { id: "fn", title: () => "S", icon: "FileText", Component }],
        ["addFilePanel", filePanel({ title: undefined })],
        ["addFilePanel", filePanel({ id: "blank", title: " " })],
        ["addCommandCenterItem", { id: "obj", title: { key: "x" }, icon: "FileText", context: "global", onSelect: Component }],
      ),
    ).toEqual([
      "Plugin label must be a non-empty string or a translation message",
      "Plugin label must be a non-empty string or a translation message",
      "File panel blank has no title",
      "Plugin label must be a non-empty string or a translation message",
    ]);
  });

  it("uses the 0.13 icon messages, and refuses unsafe SVG and component attachment icons", () => {
    expect(
      errors(
        "0.14.0",
        ["addFilePanel", filePanel({ icon: "Nope" })],
        ["addFilePanel", filePanel({ id: "blank", icon: " " })],
        ["addFilePanel", filePanel({ id: "odd", icon: 1 })],
        ["addFilePanel", filePanel({ id: "script", icon: { svg: "<svg><script>x</script></svg>" } })],
        ["addFilePanel", filePanel({ id: "remote", icon: { svg: '<svg><image href="https://x"/></svg>' } })],
        ["addAttachmentSource", { id: "drawn", title: "T", icon: Component, pickerTitle: "P", searchPlaceholder: "S", search: { name: "s" } }],
      ),
    ).toEqual([
      'File panel pdf has an invalid icon: unknown Lucide icon "Nope"',
      "File panel blank has no icon",
      "File panel odd has an invalid icon: expected a Lucide icon name, { svg }, or a component",
      "File panel script has an invalid icon: script elements are not allowed",
      "File panel remote has an invalid icon: external href references are not allowed",
      "Attachment source drawn has an invalid icon: expected a Lucide icon name or { svg }",
    ]);
  });

  it("shares workspace panel ids with agent panels and rejects other contexts", () => {
    expect(
      errors(
        "0.14.0",
        ["addWorkspacePanel", { id: "same", title: "A", icon: "FileText", context: "agent", Component }],
        ["addAgentPanel", { id: "same", title: "B", icon: "FileText", Component }],
        ["addWorkspacePanel", { id: "odd", title: "C", icon: "FileText", context: "global", Component }],
      ),
    ).toEqual(["Duplicate workspace panel: same", "Workspace panel odd has invalid context"]);
  });
});

describe("file panel selectors", () => {
  it.each([{ extensions: ["PDF"] }, { extensions: [], filenames: ["Dockerfile"] }, { extensions: ["md"], filenames: ["README"] }])("accepts %j", (files) => {
    expect(errors("0.14.0", ["addFilePanel", filePanel({ files })])).toEqual([]);
  });

  it.each([
    undefined, null, {}, { filenames: ["Makefile"] }, { extensions: [] }, { extensions: [], filenames: [] },
    { extensions: [".pdf"] }, { extensions: ["tar.gz"] }, { extensions: [""] }, { extensions: [" pdf"] }, { extensions: [1] },
    { extensions: ["*"] }, { extensions: [], filenames: ["docs/README"] }, { extensions: [], filenames: ["docs\\README"] },
    { extensions: [], filenames: ["READ?E"] }, { extensions: ["pdf"], filenames: "README" }, { extensions: ["pdf"], globs: ["*.pdf"] },
  ])("rejects %j with the app's message", (files) => {
    expect(errors("0.14.0", ["addFilePanel", filePanel({ files })])).toEqual(["File panel pdf has invalid selector"]);
  });

  it("checks duplicate ids, titles and components", () => {
    const memo = { $$typeof: Symbol.for("react.memo"), type: Component };
    expect(errors("0.14.0", ["addFilePanel", filePanel()], ["addFilePanel", filePanel({ title: " ", Component: memo })], ["addFilePanel", filePanel({ id: "Bad_Id" })])).toEqual([
      "Duplicate file panel: pdf",
      "File panel pdf has no title",
      "File panel pdf is not a component",
      "Invalid file panel id: Bad_Id",
    ]);
  });
});

describe("methods an older app lacks", () => {
  it("is undefined there, so an unguarded call is a contract error and a guarded one passes", async () => {
    const unguarded = await evaluateClientBundle(bundle(fileCall), EXAMPLE, { paseoVersion: "0.12.0", icons });
    expect(unguarded.setupError).toBeNull();
    expect(unguarded.contractErrors).toEqual([expect.stringMatching(/^Paseo 0\.12\.0 has no client\.addFilePanel \(added in 0\.13\.0\), and the contribution threw: /)]);
    const guarded = await evaluateClientBundle(bundle(`if (typeof client.addFilePanel === "function") ${fileCall}`), EXAMPLE, { paseoVersion: "0.12.0", icons });
    expect(guarded).toMatchObject({ setupError: null, contractErrors: [], contributions: [] });
    const inGuard = await evaluateClientBundle(bundle(`if ("addFilePanel" in client) ${fileCall}`), EXAMPLE, { paseoVersion: "0.13.0", icons });
    expect(inGuard).toMatchObject({ setupError: null, contractErrors: [], contributions: [{ method: "addFilePanel" }] });
    const modern = await evaluateClientBundle(bundle(fileCall), EXAMPLE, { paseoVersion: "0.13.0", icons });
    expect(modern).toMatchObject({ setupError: null, contractErrors: [], contributions: [{ method: "addFilePanel" }] });
  });
});

describe("a guarded read of a missing method", () => {
  it("does not take the blame for an unrelated throw", async () => {
    const evaluation = await evaluateClientBundle(bundle(`if (typeof client.addFilePanel === "function") ${fileCall}; JSON.parse("{")`), EXAMPLE, { paseoVersion: "0.12.0", icons });
    expect(evaluation.contractErrors).toEqual([]);
    expect(evaluation.setupError).toMatch(/JSON/);
  });

  it("accepts an SDK message stub as a label", async () => {
    const withMessage = `const { message } = require("@getpaseo/plugin/client"); client.addFilePanel({ id: "pdf", title: message("title"), icon: "FileText", files: { extensions: ["pdf"] }, Component: function () {} })`;
    expect((await evaluateClientBundle(bundle(withMessage), EXAMPLE, { paseoVersion: "0.14.0", icons })).contractErrors).toEqual([]);
  });
});

describe("which version ppd check applies", () => {
  const plugin = (range: string, body: string) => {
    const dir = scratch("ppd-contract-");
    writeFileSync(join(dir, "paseo-plugin.json"), JSON.stringify({ id: "contract", requirements: { paseo: range } }));
    writeFileSync(join(dir, "index.client.ts"), `export default function contribute(client: any) {\n  ${body};\n  return () => {};\n}\n`);
    return dir;
  };
  const source = (version: string, evaluator: string) => {
    const root = scratch("ppd-paseo-source-");
    mkdirSync(join(root, "packages/app/src/plugins"), { recursive: true });
    writeFileSync(join(root, "packages/app/package.json"), JSON.stringify({ version }));
    writeFileSync(join(root, "packages/app/src/plugins/evaluate.ts"), evaluator);
    return root;
  };

  const sourceHost = (version: string, evaluator: string) => ({ kind: "source" as const, root: source(version, evaluator) });

  it("uses the oldest app requirements.paseo admits when there is no host", async () => {
    const clientEval = async (dir: string) => (await runChecks(dir, { paseoSource: null, paseoApp: null })).find((r) => r.id === "client-eval");
    expect(await clientEval(plugin(">=0.13.0", fileCall))).toMatchObject({ status: "pass", message: "contributions: addFilePanel (checked as Paseo 0.13.0, rules copied from 0.13.0 and confirmed through 0.15.4)" });
    expect(await clientEval(plugin(">=0.12.0", fileCall))).toMatchObject({ status: "fail", details: [expect.stringContaining("Paseo 0.12.0 has no client.addFilePanel"), "contributions: none (checked as Paseo 0.12.0, rules copied from the 0.11.2 and 0.12.0 release)"] });
  });

  it("warns when the host accepts the client but an older app the range admits rejects it", async () => {
    const host = source("0.14.0", "");
    const notes = (await checkClient(plugin(">=0.12.0", fileCall), { paseoSource: host }))?.notes ?? [];
    expect(notes[0]).toMatch(/^Paseo 0\.12\.0, which requirements\.paseo ">=0\.12\.0" admits, would reject this client .*: Paseo 0\.12\.0 has no client\.addFilePanel/);
    expect((await checkClient(plugin(">=0.13.0", fileCall), { paseoSource: host }))?.notes.filter((note) => note.includes("would reject"))).toEqual([]);
  });

  it("checks against the range's lower bound when the range excludes the installed app", async () => {
    const result = await checkClient(plugin(">=0.13.0", 'client.addAgentPanel({ id: "agent", title: "A", icon: "FileText", Component: function () {} })'), { paseoSource: source("0.12.0", "") });
    expect(result?.errors).toEqual([]);
    expect(result?.notes[0]).toBe("the installed Paseo 0.12.0 is outside requirements.paseo, so it would not load this plugin; checked with Paseo 0.13.0 rules instead");
  });

  it("reads a source checkout's version, raised to the release of the newer methods its evaluator defines", () => {
    expect(paseoHostVersion(sourceHost("0.12.0", "addAgentPanel(contribution) {}\naddFilePanel(contribution) {}"))).toBe("0.13.0-beta.2");
    expect(paseoHostVersion(sourceHost("0.12.0", "addFilePanel(contribution) {}"))).toBe("0.13.0-beta.1");
    expect(paseoHostVersion(sourceHost("0.12.0", "addWorkspacePanel(contribution) {}"))).toBe("0.12.0");
    expect(paseoHostVersion(sourceHost("0.14.0", "addFilePanel(contribution) {}"))).toBe("0.14.0");
    expect(paseoHostVersion(null)).toBeUndefined();
  });
});

describe("theme shape (themes/index.ts at v0.13.0, unchanged through main)", () => {
  const theme = (patch: Record<string, unknown> = {}) => ({
    id: "midnight",
    name: "Midnight",
    appearance: "dark",
    colors: { background: "#101010", foreground: "#fff", raised: "#1a1a1a", control: "#222222", border: "#333333", mutedForeground: "#888888", ring: "#44445566" },
    ...patch,
  });

  it.each(["0.12.0", "0.14.0"])("accepts a complete theme, with or without accent, on %s", (version) => {
    expect(
      errors(
        version,
        ["addTheme", theme()],
        ["addTheme", theme({ id: "daylight", appearance: "light", colors: { ...theme().colors, accent: "#0a84ff" } })],
      ),
    ).toEqual([]);
  });

  it("takes a translation message as the name from 0.13 only", () => {
    expect(errors("0.14.0", ["addTheme", theme({ name: message })])).toEqual([]);
    expect(errors("0.12.0", ["addTheme", theme({ name: message })])).toEqual([
      "Theme midnight has no name: expected a string of 1 to 60 characters",
    ]);
  });

  it("reports an empty name and one over 60 characters", () => {
    expect(errors("0.14.0", ["addTheme", theme({ name: "  " })])).toEqual(["Theme midnight has no name"]);
    expect(errors("0.14.0", ["addTheme", theme({ name: "x".repeat(61) })])).toEqual([
      "Theme midnight has a name of 61 characters: the app allows 60",
    ]);
  });

  it("reports a missing appearance and one the app does not define", () => {
    expect(errors("0.14.0", ["addTheme", theme({ appearance: "auto" })])).toEqual([
      'Theme midnight has an invalid appearance: expected "light" or "dark"',
    ]);
    expect(errors("0.14.0", ["addTheme", { id: "midnight", name: "Midnight", colors: theme().colors }])).toEqual([
      'Theme midnight has an invalid appearance: expected "light" or "dark"',
    ]);
  });

  it("reports missing, unknown and non-hex colors", () => {
    const { background: _dropped, ...rest } = theme().colors;
    expect(errors("0.14.0", ["addTheme", theme({ colors: rest })])).toEqual(["Theme midnight is missing colors: background"]);
    expect(errors("0.14.0", ["addTheme", theme({ colors: { ...theme().colors, surface: "#000000" } })])).toEqual([
      "Theme midnight has colors the app does not accept: surface",
    ]);
    expect(errors("0.14.0", ["addTheme", theme({ colors: { ...theme().colors, border: "red", ring: "#4442" } })])).toEqual([
      "Theme midnight has colors that are not hex colors (#rgb, #rrggbb or #rrggbbaa): border, ring",
    ]);
    expect(errors("0.14.0", ["addTheme", theme({ colors: undefined })])).toEqual([
      "Theme midnight has no colors: expected background, foreground, raised, control, border, mutedForeground, ring and the optional accent",
    ]);
  });

  it("takes accent left undefined, as the optional field does", () => {
    expect(errors("0.14.0", ["addTheme", theme({ colors: { ...theme().colors, accent: undefined } })])).toEqual([]);
  });

  it("reports a key the strict schema refuses, and still reports duplicate ids", () => {
    expect(errors("0.14.0", ["addTheme", theme({ swatch: "#000000" })])).toEqual([
      "Theme midnight has keys the app does not accept: swatch",
    ]);
    expect(errors("0.14.0", ["addTheme", theme()], ["addTheme", theme()])).toEqual(["Duplicate theme: midnight"]);
  });
});

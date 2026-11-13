// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit d34d17a9072149320ace35ec2a2e5c7dcd992cb3:
//   packages/app/src/plugins/{evaluate.ts, icons.ts, themes/index.ts}, packages/plugin/src/icons.ts
// That is tag v0.13.0. The four files are byte-identical in v0.14.0 and v0.15.4 (see RULES_SOURCES, which
// test/rules-drift.test.ts re-checks against a Paseo checkout), with the v0.13.0-beta.1 and beta.2 steps. The pre-0.13
// rules are from commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e, whose evaluate.ts is the one released in 0.11.2 and
// 0.12.0; its theme schema differs only in `name`, which takes a translation message from 0.13.
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.
// Modified: the registration checks are rewritten as a standalone class with no app or React dependencies, take the
// icon set and host version as parameters, and collect every violation instead of throwing on the first.
//
// The app's client registration rules. The app throws on the first violation and the whole plugin client fails
// to evaluate; the only trace is a console.warn("[Plugins] Failed to evaluate ..."). Here every violation is
// collected instead.
import coerce from "semver/functions/coerce.js";
import compareVersions from "semver/functions/compare.js";
import parse from "semver/functions/parse.js";
import { VERIFIED_PASEO } from "../compat.ts";

/** The Paseo release these rules were copied from, and the last release confirmed to still use them. */
export const RULES_CAPTURED = "0.13.0";
export const RULES_CONFIRMED_THROUGH = "0.15.4";

/**
 * The upstream files this one copies, with their SHA-256 at RULES_CONFIRMED_THROUGH. A copy with no alarm goes
 * stale silently, and `ppd check` would keep passing plugins against rules nobody has re-read, so
 * test/rules-drift.test.ts compares these against a Paseo checkout whenever PASEO_SOURCE is set.
 *
 * When one of these fails: read the upstream file, update the rules below if they changed, then record the new
 * digest here and set RULES_CONFIRMED_THROUGH to the release that was read.
 */
export const RULES_SOURCES: Readonly<Record<string, string>> = {
  "packages/app/src/plugins/evaluate.ts": "ccf7a268c73e900429083968dcdb0c6ea3fd71eeb238fcd7c8f4bf30c5f435f1",
  "packages/app/src/plugins/icons.ts": "8da8331c93353a3b78bec8075be0274a5e80bea054a513898f44dbc90a6d3e42",
  "packages/app/src/plugins/themes/index.ts": "cee518a29faca5aaadc73f0fb5a2b5352fdb827ace882baacc837a4ec66bdbc1",
  "packages/plugin/src/icons.ts": "a63be14cdcf53e56871178cade18e30e27fd1009c18be643b969f245be43e04c",
};

/** The pre-0.13 rules in this file are the evaluator released in these two versions. */
export const RULES_CAPTURED_LEGACY = "0.11.2 and 0.12.0";

/**
 * How the rules relate to the version they are applied as. `ppd check` used to print "(Paseo <host> rules)",
 * which claims the host's own rules were applied; they are a copy, and a host released after
 * RULES_CONFIRMED_THROUGH may have rules nobody has read into this file.
 */
export function rulesProvenance(appliedAs: string): string {
  if (!hasContract013(appliedAs)) return `checked as Paseo ${appliedAs}, rules copied from the ${RULES_CAPTURED_LEGACY} release`;
  const note = `checked as Paseo ${appliedAs}, rules copied from ${RULES_CAPTURED} and confirmed through ${RULES_CONFIRMED_THROUGH}`;
  const normalized = coerce(appliedAs)?.version ?? appliedAs;
  return compareVersions(normalized, RULES_CONFIRMED_THROUGH) > 0 ? `${note}; newer rules unchecked` : note;
}

const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;
const PANEL_LOCATIONS = ["workspace", "explorer"];
const TIMELINE_ITEM_TYPES = ["user_message", "assistant_message", "reasoning", "tool_call", "todo", "error", "compaction"];
const THEME_KEYS = ["id", "name", "appearance", "colors"];
const THEME_APPEARANCES = ["light", "dark"];
const THEME_COLORS = ["background", "foreground", "raised", "control", "border", "mutedForeground", "ring"];
const THEME_OPTIONAL_COLORS = ["accent"];
const THEME_NAME_MAX = 60;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HEX_SHAPES = "#rgb, #rrggbb or #rrggbbaa";
/** File panels, translated labels, `{ svg }` and component icons, and the notification timeline item. */
export const CONTRACT_0_13 = "0.13.0-beta.1";
/** Agent panels, and workspace panels without `context`. */
export const PANELS_0_13 = "0.13.0-beta.2";
const LABEL_ERROR = "Plugin label must be a non-empty string or a translation message";
const SVG_ICON_MAX_BYTES = 64 * 1024;
const EXTERNAL_HREF = /\s(?:href|xlink:href)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;

type Contribution = Record<string, unknown>;

/** Methods of the app's PluginClientContext. Anything else is `undefined` in the app and throws when called. */
export const CLIENT_CONTEXT_METHODS = new Set([
  "addSettingsScreen",
  "addScreen",
  "addSidebarHeaderItem",
  "addSidebarFooterItem",
  "addSurface",
  "addSidebarItem",
  "addWorkspacePanel",
  "addAgentPanel",
  "addFilePanel",
  "addCommandCenterItem",
  "addSlashCommand",
  "addAttachmentSource",
  "addTheme",
  "addTimelineTransformer",
  "addTimelineRenderer",
  "addComposerPill",
  "addHeaderButton",
]);

/** Client context methods that only newer apps have, with the release that added each. Older apps leave them undefined. */
export const CLIENT_METHOD_SINCE: ReadonlyMap<string, string> = new Map([
  ["addAgentPanel", PANELS_0_13],
  ["addFilePanel", CONTRACT_0_13],
]);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isFunction = (value: unknown): boolean => typeof value === "function";
const isComponentType = (value: unknown): boolean =>
  typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
const isSvgIcon = (icon: unknown): icon is { svg: string } =>
  typeof icon === "object" && icon !== null && !("$$typeof" in icon) && typeof Reflect.get(icon, "svg") === "string";
const selectorEntries = (entries: unknown, extension: boolean): entries is string[] =>
  Array.isArray(entries) &&
  entries.every((entry) => typeof entry === "string" && entry.trim() === entry && entry.length > 0 && !/[\\/*?]/.test(entry) && (!extension || !entry.includes(".")));

/** A file panel's `files`: only `extensions` (no dots) and optional `filenames`, plain names, at least one in all. */
function validFileSelector(files: unknown): boolean {
  if (!files || typeof files !== "object") return false;
  const { extensions, filenames, ...rest } = files as Record<string, unknown>;
  return Object.keys(rest).length === 0 && selectorEntries(extensions, true) && (filenames === undefined || selectorEntries(filenames, false)) &&
    extensions.length + (Array.isArray(filenames) ? filenames.length : 0) > 0;
}

/** findSvgIconProblem: why the app refuses an inline SVG icon, or null. */
export function svgIconProblem(svg: string): string | null {
  if (Buffer.byteLength(svg) > SVG_ICON_MAX_BYTES) return "exceeds 64 KiB";
  if (!/^\s*<svg(?:\s|>)/i.test(svg)) return "not an SVG document";
  if (/<script(?:\s|>)/i.test(svg)) return "script elements are not allowed";
  if (/<foreignObject(?:\s|>)/i.test(svg)) return "foreignObject elements are not allowed";
  if (/<style(?:\s|>)/i.test(svg)) return "style elements are not allowed";
  if (/\son[a-z0-9_-]*\s*=/i.test(svg)) return "event-handler attributes are not allowed";
  if (/javascript\s*:/i.test(svg)) return "javascript URLs are not allowed";
  for (const match of svg.matchAll(EXTERNAL_HREF)) {
    if (!(match[2] ?? match[3] ?? "").startsWith("#")) return "external href references are not allowed";
  }
  return null;
}

/** Whether `version` (an app or source version; a prerelease sorts below its release) is at least `since`. */
export function atLeast(version: string, since: string): boolean {
  const parsed = parse(version) ?? coerce(version);
  return parsed !== null && compareVersions(parsed, since) >= 0;
}

/** Whether `version` has the 0.13 client contract. */
export function hasContract013(version: string): boolean {
  return atLeast(version, CONTRACT_0_13);
}

/** A TypeError from calling `method` while it is undefined, under any receiver name a bundler gives `client`. */
function callsMissing(error: unknown, method: string): boolean {
  return error instanceof TypeError && new RegExp(`\\b${method} is not a function`).test(error.message);
}

/**
 * Validates registrations like the evaluate.ts of the app at `paseoVersion` (default: the verified release).
 * `icons` is the app's Lucide name set; null skips the icon-name rule (no icon list available).
 */
export class ClientRules {
  readonly errors: string[] = [];
  private readonly ids = new Map<string, Set<string>>();
  private readonly surfaces = new Set<string>();
  private readonly legacySidebarSurfaces: { id: string; surface: string }[] = [];
  private readonly absentRead = new Set<string>();

  private readonly icons: ReadonlySet<string> | null;
  readonly paseoVersion: string;
  private readonly modern: boolean;
  private readonly flatPanels: boolean;
  private readonly isMessage: (value: unknown) => boolean;

  /**
   * `isMessage` recognizes the translation messages the SDK's `message()` creates. The evaluator stubs the SDK, so it
   * passes its stub check; without one, no value is a message.
   */
  constructor(icons: ReadonlySet<string> | null, paseoVersion: string = VERIFIED_PASEO, isMessage: (value: unknown) => boolean = () => false) {
    this.icons = icons;
    this.paseoVersion = paseoVersion;
    this.modern = hasContract013(paseoVersion);
    this.flatPanels = atLeast(paseoVersion, PANELS_0_13);
    this.isMessage = isMessage;
  }

  /** Whether the app at this version defines `client.<method>`. A read of a missing one is remembered. */
  has(method: string): boolean {
    const since = CLIENT_METHOD_SINCE.get(method);
    if (since === undefined || atLeast(this.paseoVersion, since)) return true;
    this.absentRead.add(method);
    return false;
  }

  private fail(message: string): void {
    this.errors.push(message);
  }

  private id(value: unknown, label: string): string | null {
    const id = text(value);
    if (!CONTRIBUTION_ID.test(id)) {
      this.fail(`Invalid ${label}: ${String(value)}`);
      return null;
    }
    return id;
  }

  private unique(scope: string, id: string, duplicate: string): void {
    const seen = this.ids.get(scope) ?? new Set<string>();
    this.ids.set(scope, seen);
    if (seen.has(id)) this.fail(`${duplicate}: ${id}`);
    seen.add(id);
  }

  /**
   * A label: a non-empty string, and from 0.13 a translation message too. From 0.13 a value that is neither throws
   * the SDK's own message (requirePluginText); an empty string gets `missing`, like before 0.13.
   */
  private label(value: unknown, missing: string): void {
    if (typeof value === "string" ? value.trim() !== "" : this.modern && this.isMessage(value)) return;
    this.fail(this.modern && typeof value !== "string" ? LABEL_ERROR : missing);
  }

  /** The pre-0.13 rule: a Lucide name only. */
  private lucide(name: unknown, owner: string): void {
    if (!this.icons) return;
    const icon = text(name);
    if (!this.icons.has(icon)) this.fail(this.modern ? `${owner} has an invalid icon: unknown Lucide icon "${icon}"` : `Unknown Lucide icon: ${String(name)}`);
  }

  /** The icon rule: before 0.13 a non-empty Lucide name; from 0.13 parsePluginIcon (`serializable` refuses components). */
  private icon(owner: string, icon: unknown, serializable = false): void {
    if (!this.modern || typeof icon === "string") {
      if (!text(icon)) this.fail(`${owner} has no icon`);
      else this.lucide(icon, owner);
      return;
    }
    if (!serializable && isComponentType(icon)) return;
    if (!isSvgIcon(icon)) {
      this.fail(`${owner} has an invalid icon: expected a Lucide icon name${serializable ? " or { svg }" : ", { svg }, or a component"}`);
      return;
    }
    const problem = svgIconProblem(icon.svg.trim());
    if (problem) this.fail(`${owner} has an invalid icon: ${problem}`);
  }

  /**
   * The theme shape. The app parses the contribution through a strict zod schema inside `addTheme`, so one bad color,
   * one missing key or one extra key throws and the whole client is dropped with no theme-specific message. The
   * schema is byte-identical from v0.13.0 through main; the pre-0.13 one differs only in `name`.
   */
  private theme(id: string, c: Contribution): void {
    const extra = Object.keys(c).filter((key) => !THEME_KEYS.includes(key));
    if (extra.length) this.fail(`Theme ${id} has keys the app does not accept: ${extra.join(", ")}`);

    if (typeof c.name === "string") {
      const name = c.name.trim();
      if (!name) this.fail(`Theme ${id} has no name`);
      else if (name.length > THEME_NAME_MAX) this.fail(`Theme ${id} has a name of ${name.length} characters: the app allows ${THEME_NAME_MAX}`);
    } else if (!(this.modern && this.isMessage(c.name))) {
      this.fail(`Theme ${id} has no name: ${this.modern ? "expected a string of 1 to 60 characters or a translation message" : "expected a string of 1 to 60 characters"}`);
    }

    if (typeof c.appearance !== "string" || !THEME_APPEARANCES.includes(c.appearance)) {
      this.fail(`Theme ${id} has an invalid appearance: expected "light" or "dark"`);
    }

    const colors = c.colors;
    if (typeof colors !== "object" || colors === null || Array.isArray(colors)) {
      this.fail(`Theme ${id} has no colors: expected ${THEME_COLORS.join(", ")} and the optional accent`);
      return;
    }
    const entries = colors as Record<string, unknown>;
    const missing = THEME_COLORS.filter((key) => !(key in entries));
    if (missing.length) this.fail(`Theme ${id} is missing colors: ${missing.join(", ")}`);
    const unknown = Object.keys(entries).filter((key) => !THEME_COLORS.includes(key) && !THEME_OPTIONAL_COLORS.includes(key));
    if (unknown.length) this.fail(`Theme ${id} has colors the app does not accept: ${unknown.join(", ")}`);
    // An optional color left undefined is absent to the schema; a required one left undefined is not a hex color.
    const invalid = [...THEME_COLORS, ...THEME_OPTIONAL_COLORS].filter(
      (key) =>
        key in entries &&
        !(THEME_OPTIONAL_COLORS.includes(key) && entries[key] === undefined) &&
        !(typeof entries[key] === "string" && HEX_COLOR.test(entries[key] as string)),
    );
    if (invalid.length) this.fail(`Theme ${id} has colors that are not hex colors (${HEX_SHAPES}): ${invalid.join(", ")}`);
  }

  private sidebarItem(section: "header" | "footer", c: Contribution): void {
    const id = this.id(c.id, `sidebar ${section} item id`);
    if (!id) return;
    this.unique(`sidebar-${section}`, id, `Duplicate sidebar ${section} item`);
    this.label(c.title, `Sidebar item ${id} has no title`);
    if (!isComponentType(c.Component)) this.fail(`Sidebar item ${id} is not a component`);
  }

  private panel(c: Contribution, context: unknown): void {
    const id = this.id(c.id, "workspace panel id");
    if (!id) return;
    this.unique("workspace-panel", id, "Duplicate workspace panel");
    this.label(c.title, `Workspace panel ${id} has no title`);
    this.icon(`Workspace panel ${id}`, c.icon);
    const contexts = this.flatPanels ? [undefined, "workspace", "agent"] : ["workspace", "agent"];
    if (!contexts.includes(context as string)) this.fail(`Workspace panel ${id} has invalid context`);
    if (!isFunction(c.Component)) this.fail(`Workspace panel ${id} is not a component`);
    if (c.locations !== undefined) {
      const locations = c.locations;
      if (!Array.isArray(locations) || locations.length === 0) this.fail(`Workspace panel ${id} must support at least one location`);
      else {
        for (const location of locations) if (!PANEL_LOCATIONS.includes(location)) this.fail(`Workspace panel ${id} has invalid location: ${String(location)}`);
        if (new Set(locations).size !== locations.length) this.fail(`Workspace panel ${id} has duplicate locations`);
      }
    }
  }

  /** Checks one `client.<method>(...)` call. */
  register(method: string, args: unknown[]): void {
    const c = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Contribution;
    switch (method) {
      case "addSettingsScreen": {
        const id = this.id(c.id, "settings screen id");
        if (!id) return;
        this.unique("settings-screen", id, "Duplicate settings screen");
        this.label(c.title, `Invalid settings screen: ${id}`);
        if (this.modern) this.icon(`Settings screen ${id}`, c.icon);
        else this.lucide(c.icon, `Settings screen ${id}`);
        return;
      }
      case "addScreen":
      case "addSurface": {
        const screen = method === "addSurface" ? { id: args[0], title: args[0], Component: args[1] } : c;
        const id = this.id(screen.id, "screen id");
        if (!id) return;
        this.unique("screen", id, "Duplicate screen");
        this.surfaces.add(id);
        const title = screen.title;
        if (typeof title !== "function" && !(typeof title === "string" ? title.trim() : this.modern && this.isMessage(title))) this.fail(`Screen ${id} needs a title: a non-empty string or a function of params`);
        if (!isComponentType(screen.Component)) this.fail(`Screen ${id} is not a component`);
        return;
      }
      case "addSidebarHeaderItem":
        return this.sidebarItem("header", c);
      case "addSidebarFooterItem":
        return this.sidebarItem("footer", c);
      case "addSidebarItem": {
        const id = this.id(c.id, "sidebar item id");
        if (!id) return;
        this.icon(`Sidebar item ${id}`, c.icon);
        const surface = this.id(c.surface, "sidebar surface id");
        this.unique("sidebar-header", id, "Duplicate sidebar header item");
        this.label(c.title, `Sidebar item ${id} has no title`);
        if (surface) this.legacySidebarSurfaces.push({ id, surface });
        return;
      }
      case "addWorkspacePanel":
        return this.panel(c, c.context);
      case "addAgentPanel":
        return this.panel(c, "agent");
      case "addFilePanel": {
        const id = this.id(c.id, "file panel id");
        if (!id) return;
        this.unique("file-panel", id, "Duplicate file panel");
        this.label(c.title, `File panel ${id} has no title`);
        this.icon(`File panel ${id}`, c.icon);
        if (!validFileSelector(c.files)) this.fail(`File panel ${id} has invalid selector`);
        if (!isFunction(c.Component)) this.fail(`File panel ${id} is not a component`);
        return;
      }
      case "addCommandCenterItem": {
        const id = this.id(c.id, "Command Center item id");
        if (!id) return;
        this.unique("command-center", id, "Duplicate Command Center item");
        this.label(c.title, `Command Center item ${id} has no title`);
        this.icon(`Command Center item ${id}`, c.icon);
        if (c.context !== "global" && c.context !== "workspace" && c.context !== "agent") this.fail(`Command Center item ${id} has invalid context`);
        if (!isFunction(c.onSelect)) this.fail(`Command Center item ${id} has no callback`);
        return;
      }
      case "addSlashCommand": {
        const name = this.id(c.name, "client slash command name");
        if (!name) return;
        this.unique("slash-command", name, "Duplicate client slash command");
        this.label(c.description, `Client slash command ${name} has no description`);
        if (c.context !== "workspace" && c.context !== "agent") this.fail(`Client slash command ${name} has invalid context`);
        if (!isFunction(c.onSubmit)) this.fail(`Client slash command ${name} has no callback`);
        if (typeof c.argumentHint !== "string" && !(this.modern && this.isMessage(c.argumentHint))) {
          this.fail(this.modern ? LABEL_ERROR : `Client slash command ${name} has no argumentHint string`);
        }
        return;
      }
      case "addAttachmentSource": {
        const id = this.id(c.id, "attachment source id");
        if (!id) return;
        this.unique("attachment-source", id, "Duplicate attachment source");
        this.label(c.title, `Attachment source ${id} has no title`);
        this.icon(`Attachment source ${id}`, c.icon, true);
        this.label(c.pickerTitle, `Attachment source ${id} has no picker title`);
        this.label(c.searchPlaceholder, `Attachment source ${id} has no search placeholder`);
        if (!text((c.search as { name?: unknown } | undefined)?.name)) this.fail(`Attachment source ${id} has no search RPC`);
        return;
      }
      case "addTheme": {
        const id = this.id(c.id, "theme id");
        if (!id) return;
        this.unique("theme", id, "Duplicate theme");
        this.theme(id, c);
        return;
      }
      case "addTimelineTransformer": {
        const id = this.id(c.id, "timeline transformer id");
        if (!id) return;
        this.unique("timeline-transformer", id, "Duplicate timeline transformer");
        const itemType = (c.query as { itemType?: unknown } | undefined)?.itemType;
        const itemTypes = this.modern ? [...TIMELINE_ITEM_TYPES, "notification"] : TIMELINE_ITEM_TYPES;
        if (typeof itemType !== "string") this.fail(`Timeline transformer ${id} has no item type`);
        else if (!itemTypes.includes(itemType)) this.fail(`Timeline transformer ${id} has invalid item type: ${itemType}`);
        if (!isFunction(c.transform)) this.fail(`Timeline transformer ${id} has no transform`);
        if (c.id !== id) this.fail(`Invalid timeline transformer id: ${String(c.id)}`);
        return;
      }
      case "addTimelineRenderer": {
        const kind = this.id(c.kind, "timeline renderer kind");
        if (!kind) return;
        const version = c.version;
        if (!Number.isInteger(version) || (version as number) < 1) this.fail(`Timeline renderer ${kind} has invalid version`);
        const id = `${kind}/${String(version)}`;
        this.unique("timeline-renderer", id, "Duplicate timeline renderer");
        if (typeof (c.schema as { safeParse?: unknown } | undefined)?.safeParse !== "function") this.fail(`Timeline renderer ${id} has no schema`);
        if (!isFunction(c.Component)) this.fail(`Timeline renderer ${id} is not a component`);
        return;
      }
      case "addComposerPill":
      case "addHeaderButton":
        return;
      default:
        this.fail(`client.${method} is not part of the app's plugin client context (calling it throws)`);
    }
  }

  /**
   * The contribution threw. When it read a method this app version lacks, that is the cause the app would hit too,
   * so it is a contract error rather than a possible stub limit. Returns whether it was.
   */
  threw(error: unknown): boolean {
    const method = [...this.absentRead].find((name) => callsMissing(error, name));
    if (!method) return false;
    this.fail(`Paseo ${this.paseoVersion} has no client.${method} (added in ${CLIENT_METHOD_SINCE.get(method)!.replace(/-.*/, "")}), and the contribution threw: ${(error as Error).message}. Guard the call with typeof, or require a newer Paseo`);
    return true;
  }

  /** After setup: the contribution must return a cleanup, and legacy sidebar items need their surface. */
  finish(cleanup: unknown): void {
    if (typeof cleanup !== "function") this.fail("Plugin contribution must return a cleanup function");
    for (const item of this.legacySidebarSurfaces) {
      if (!this.surfaces.has(item.surface)) this.fail(`Sidebar item ${item.id} references missing surface ${item.surface}`);
    }
  }
}

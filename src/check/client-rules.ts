// The app's client registration rules, vendored from packages/app/src/plugins/evaluate.ts (getpaseo/paseo
// 9bd58f66b). The app throws on the first violation and the whole plugin client fails to evaluate; the only
// trace is a console.warn("[Plugins] Failed to evaluate ..."). Here every violation is collected instead.

const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;
const PANEL_LOCATIONS = ["workspace", "explorer"];
const TIMELINE_ITEM_TYPES = new Set(["user_message", "assistant_message", "reasoning", "tool_call", "todo", "error", "compaction"]);

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
  "addCommandCenterItem",
  "addSlashCommand",
  "addAttachmentSource",
  "addTheme",
  "addTimelineTransformer",
  "addTimelineRenderer",
  "addComposerPill",
  "addHeaderButton",
]);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isFunction = (value: unknown): boolean => typeof value === "function";
const isComponentType = (value: unknown): boolean =>
  typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);

/**
 * Validates registrations like the app's evaluate.ts. `icons` is the app's Lucide name set; null skips the
 * icon rule (no icon list available).
 */
export class ClientRules {
  readonly errors: string[] = [];
  private readonly ids = new Map<string, Set<string>>();
  private readonly surfaces = new Set<string>();
  private readonly legacySidebarSurfaces: { id: string; surface: string }[] = [];

  private readonly icons: ReadonlySet<string> | null;

  constructor(icons: ReadonlySet<string> | null) {
    this.icons = icons;
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

  private icon(name: unknown): void {
    if (!this.icons) return;
    const icon = text(name);
    if (!this.icons.has(icon)) this.fail(`Unknown Lucide icon: ${String(name)}`);
  }

  private sidebarItem(section: "header" | "footer", c: Contribution): void {
    const id = this.id(c.id, `sidebar ${section} item id`);
    if (!id) return;
    this.unique(`sidebar-${section}`, id, `Duplicate sidebar ${section} item`);
    if (!text(c.title)) this.fail(`Sidebar item ${id} has no title`);
    if (!isComponentType(c.Component)) this.fail(`Sidebar item ${id} is not a component`);
  }

  /** Checks one `client.<method>(...)` call. */
  register(method: string, args: unknown[]): void {
    const c = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Contribution;
    switch (method) {
      case "addSettingsScreen": {
        const id = this.id(c.id, "settings screen id");
        if (!id) return;
        this.unique("settings-screen", id, "Duplicate settings screen");
        if (!text(c.title)) this.fail(`Invalid settings screen: ${id}`);
        this.icon(c.icon);
        return;
      }
      case "addScreen":
      case "addSurface": {
        const screen = method === "addSurface" ? { id: args[0], title: args[0], Component: args[1] } : c;
        const id = this.id(screen.id, "screen id");
        if (!id) return;
        this.unique("screen", id, "Duplicate screen");
        this.surfaces.add(id);
        if (typeof screen.title !== "function" && !text(screen.title)) this.fail(`Screen ${id} needs a title: a non-empty string or a function of params`);
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
        if (!text(c.icon)) this.fail(`Sidebar item ${id} has no icon`);
        else this.icon(c.icon);
        const surface = this.id(c.surface, "sidebar surface id");
        this.unique("sidebar-header", id, "Duplicate sidebar header item");
        if (!text(c.title)) this.fail(`Sidebar item ${id} has no title`);
        if (surface) this.legacySidebarSurfaces.push({ id, surface });
        return;
      }
      case "addWorkspacePanel": {
        const id = this.id(c.id, "workspace panel id");
        if (!id) return;
        this.unique("workspace-panel", id, "Duplicate workspace panel");
        if (!text(c.title)) this.fail(`Workspace panel ${id} has no title`);
        if (!text(c.icon)) this.fail(`Workspace panel ${id} has no icon`);
        if (c.context !== "workspace" && c.context !== "agent") this.fail(`Workspace panel ${id} has invalid context`);
        if (!isFunction(c.Component)) this.fail(`Workspace panel ${id} is not a component`);
        if (text(c.icon)) this.icon(c.icon);
        if (c.locations !== undefined) {
          const locations = c.locations;
          if (!Array.isArray(locations) || locations.length === 0) this.fail(`Workspace panel ${id} must support at least one location`);
          else {
            for (const location of locations) if (!PANEL_LOCATIONS.includes(location)) this.fail(`Workspace panel ${id} has invalid location: ${String(location)}`);
            if (new Set(locations).size !== locations.length) this.fail(`Workspace panel ${id} has duplicate locations`);
          }
        }
        return;
      }
      case "addCommandCenterItem": {
        const id = this.id(c.id, "Command Center item id");
        if (!id) return;
        this.unique("command-center", id, "Duplicate Command Center item");
        if (!text(c.title)) this.fail(`Command Center item ${id} has no title`);
        if (!text(c.icon)) this.fail(`Command Center item ${id} has no icon`);
        if (c.context !== "global" && c.context !== "workspace" && c.context !== "agent") this.fail(`Command Center item ${id} has invalid context`);
        if (!isFunction(c.onSelect)) this.fail(`Command Center item ${id} has no callback`);
        if (text(c.icon)) this.icon(c.icon);
        return;
      }
      case "addSlashCommand": {
        const name = this.id(c.name, "client slash command name");
        if (!name) return;
        this.unique("slash-command", name, "Duplicate client slash command");
        if (!text(c.description)) this.fail(`Client slash command ${name} has no description`);
        if (c.context !== "workspace" && c.context !== "agent") this.fail(`Client slash command ${name} has invalid context`);
        if (!isFunction(c.onSubmit)) this.fail(`Client slash command ${name} has no callback`);
        if (typeof c.argumentHint !== "string") this.fail(`Client slash command ${name} has no argumentHint string`);
        return;
      }
      case "addAttachmentSource": {
        const id = this.id(c.id, "attachment source id");
        if (!id) return;
        this.unique("attachment-source", id, "Duplicate attachment source");
        for (const [field, label] of [["title", "title"], ["icon", "icon"], ["pickerTitle", "picker title"], ["searchPlaceholder", "search placeholder"]] as const) {
          if (!text(c[field])) this.fail(`Attachment source ${id} has no ${label}`);
        }
        if (!text((c.search as { name?: unknown } | undefined)?.name)) this.fail(`Attachment source ${id} has no search RPC`);
        if (text(c.icon)) this.icon(c.icon);
        return;
      }
      case "addTheme": {
        const id = this.id(c.id, "theme id");
        if (id) this.unique("theme", id, "Duplicate theme");
        return;
      }
      case "addTimelineTransformer": {
        const id = this.id(c.id, "timeline transformer id");
        if (!id) return;
        this.unique("timeline-transformer", id, "Duplicate timeline transformer");
        const itemType = (c.query as { itemType?: unknown } | undefined)?.itemType;
        if (typeof itemType !== "string") this.fail(`Timeline transformer ${id} has no item type`);
        else if (!TIMELINE_ITEM_TYPES.has(itemType)) this.fail(`Timeline transformer ${id} has invalid item type: ${itemType}`);
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

  /** After setup: the contribution must return a cleanup, and legacy sidebar items need their surface. */
  finish(cleanup: unknown): void {
    if (typeof cleanup !== "function") this.fail("Plugin contribution must return a cleanup function");
    for (const item of this.legacySidebarSurfaces) {
      if (!this.surfaces.has(item.surface)) this.fail(`Sidebar item ${item.id} references missing surface ${item.surface}`);
    }
  }
}

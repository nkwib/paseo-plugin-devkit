// Playwright page object for the Paseo web UI served by a dev daemon, plus `ppd web`.
// Selectors use accessible names that the Paseo app ships (aria-labels and the Command Center
// placeholder), so plugin tests do not rediscover them.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Browser, Locator, Page } from "playwright-core";
import { ISSUES_URL, VERIFIED_PASEO } from "./compat.ts";
import { requireDaemon, type DaemonRecord } from "./daemon.ts";
import { runPaseo } from "./paseo.ts";
import { UsageError } from "./usage.ts";

/** Waits for a UI element ppd finds by label; a timeout says which label, since a newer web UI may rename it. */
async function waitForUi(locator: Locator, what: string, timeout: number): Promise<void> {
  try {
    await locator.waitFor({ timeout });
  } catch (error) {
    if ((error as Error).name !== "TimeoutError") throw error;
    throw new Error(
      `the Paseo web UI did not show ${what} within ${timeout / 1000} s. ppd finds it by the labels of the Paseo ${VERIFIED_PASEO} web UI; a different version may have renamed it (please report it at ${ISSUES_URL})`,
      { cause: error },
    );
  }
}

export interface Viewport {
  width: number;
  height: number;
}

export function parseViewport(value: string): Viewport {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value.trim());
  if (!match) throw new Error(`viewport must look like 390x844, got ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Phones and small tablets get the compact layout; give them touch and a high DPR like a device. */
export function isCompactViewport(viewport: Viewport): boolean {
  return viewport.width < 768;
}

export interface LaunchOptions {
  url: string;
  viewport?: Viewport;
  headed?: boolean;
  executablePath?: string;
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
};

async function launchBrowser(options: LaunchOptions): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const headless = !options.headed;
  const executablePath = options.executablePath ?? process.env.PPD_BROWSER ?? process.env.CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) return chromium.launch({ headless, executablePath });
  // Full Chrome first: headless-shell differs in media timing, and Chrome needs no download.
  if ((CHROME_PATHS[process.platform] ?? []).some(existsSync)) return chromium.launch({ headless, channel: "chrome" });
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    throw new Error(`no browser for Playwright: install Google Chrome, run \`npx playwright-core install chromium\`, or set PPD_BROWSER\n${(error as Error).message}`);
  }
}

/**
 * The app evaluates plugin clients in the page and reports a failure only as
 * console.warn("[Plugins] Failed to evaluate <serverId>/<pluginId>", error) (packages/app/src/plugins/registry.ts).
 * Returns "<pluginId>: <error>" for such a console message, else null.
 */
export function pluginEvaluationFailure(text: string): string | null {
  const match = /^\[Plugins\] Failed to evaluate [^/\s]+\/(\S+)\s*(.*)$/m.exec(text);
  return match ? `${match[1]}: ${match[2]?.trim() || "unknown error"}` : null;
}

export class PaseoWeb {
  /** Console errors, page errors and plugin evaluation failures. */
  readonly errors: string[] = [];
  /** Plugins whose client the app failed to evaluate: none of their UI exists. "<pluginId>: <error>". */
  readonly pluginErrors: string[] = [];
  readonly browser: Browser;
  readonly page: Page;
  readonly baseUrl: string;

  private constructor(browser: Browser, page: Page, baseUrl: string) {
    this.browser = browser;
    this.page = page;
    this.baseUrl = baseUrl;
    page.on("console", (message) => {
      const failure = message.type() === "warning" ? pluginEvaluationFailure(message.text()) : null;
      if (failure) {
        if (!this.pluginErrors.includes(failure)) this.pluginErrors.push(failure);
        this.errors.push(`[Plugins] Failed to evaluate ${failure}`);
      } else if (message.type() === "error") this.errors.push(message.text().slice(0, 500));
    });
    page.on("pageerror", (error) => this.errors.push(`pageerror: ${error.message}`));
  }

  static async launch(options: LaunchOptions): Promise<PaseoWeb> {
    const viewport = options.viewport ?? { width: 1400, height: 900 };
    const compact = isCompactViewport(viewport);
    const browser = await launchBrowser(options);
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: compact ? 3 : 2,
      isMobile: compact,
      hasTouch: compact,
    });
    const web = new PaseoWeb(browser, page, options.url.replace(/\/$/, ""));
    await web.gotoRoute("/");
    return web;
  }

  /** Waits for the app shell: the sidebar on wide layouts, the menu button on compact ones. */
  async ready(timeoutMs = 60_000): Promise<void> {
    const shell = this.page.getByLabel("New workspace", { exact: true }).or(this.page.getByLabel("Open menu", { exact: true })).first();
    await waitForUi(shell, 'its app shell (a "New workspace" or "Open menu" button)', timeoutMs);
  }

  /** Deep links work only after the app has registered the daemon, so the root loads first. */
  async gotoRoute(route: string): Promise<void> {
    if (route !== "/" && !this.page.url().startsWith(this.baseUrl)) await this.gotoRoute("/");
    await this.page.goto(`${this.baseUrl}${route.startsWith("/") ? route : `/${route}`}`);
    await this.ready();
  }

  async openWorkspace(serverId: string, workspaceId: string): Promise<void> {
    await this.gotoRoute(`/h/${serverId}/workspace/${workspaceId}`);
    await waitForUi(this.page.getByLabel("Workspace actions", { exact: true }).first(), 'the workspace (a "Workspace actions" button)', 30_000);
  }

  /** An element by its exact accessible name, such as a plugin header button's label. */
  control(label: string): Locator {
    return this.page.getByLabel(label, { exact: true }).first();
  }

  async click(label: string): Promise<void> {
    await this.control(label).click();
  }

  commandCenterInput(): Locator {
    return this.page.getByPlaceholder(/^Search commands/);
  }

  /** Wide layouts use the keyboard shortcut; compact layouts go through the menu's Search entry. */
  async openCommandCenter(): Promise<void> {
    const menu = this.page.getByLabel("Open menu", { exact: true });
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      await this.page.getByLabel("Search", { exact: true }).first().click();
    } else {
      await this.page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    }
    await waitForUi(this.commandCenterInput(), 'the Command Center (a "Search commands" input)', 10_000);
  }

  /** Opens the Command Center, filters by text and selects the first matching item. */
  async runCommand(text: string): Promise<void> {
    await this.openCommandCenter();
    await this.commandCenterInput().fill(text);
    await this.page.getByText(text, { exact: true }).last().click();
  }

  async shot(path: string, fullPage = false): Promise<string> {
    const file = resolve(path);
    mkdirSync(dirname(file), { recursive: true });
    await this.page.screenshot({ path: file, fullPage });
    return file;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

interface WorkspaceEntry {
  workspaceId: string;
  name: string;
  cwd: string;
}

export function pickWorkspace(entries: WorkspaceEntry[], wanted?: string): WorkspaceEntry | null {
  if (wanted) {
    const absolute = resolve(wanted);
    return entries.find((entry) => entry.workspaceId === wanted || entry.name === wanted || entry.cwd === absolute) ?? null;
  }
  return entries.length === 1 ? entries[0]! : null;
}

/** Why `ppd web` opened no workspace when none was named: shown instead of a silent start page. */
export function noWorkspaceNote(entries: WorkspaceEntry[]): string {
  return entries.length
    ? `${entries.length} workspaces on the dev daemon, none opened: pass --workspace <id, name or dir> (ids: ${entries.map((entry) => entry.workspaceId).join(", ")})`
    : "no workspace on the dev daemon, showing the start page: `ppd daemon up --workspace <dir>` creates one";
}

function daemonJson<T>(daemon: DaemonRecord, args: string[]): T | null {
  const result = runPaseo(daemon.paseoBin, daemon.home, [...args, "--json"], { timeoutMs: 30_000 });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

export async function webCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      shot: { type: "string" },
      viewport: { type: "string" },
      path: { type: "string" },
      workspace: { type: "string" },
      command: { type: "string" },
      click: { type: "string", multiple: true },
      wait: { type: "string" },
      headed: { type: "boolean" },
      "full-page": { type: "boolean" },
    },
    strict: true,
  });
  if (values.wait !== undefined && !/^\d+$/.test(values.wait)) throw new UsageError(`--wait must be milliseconds, got ${values.wait}`);
  const daemon = requireDaemon(values.name);
  if (!daemon.webDist) throw new Error("this dev daemon has no web UI: restart it with `ppd daemon up --web-dist <dir>`");
  const viewport = values.viewport ? parseViewport(values.viewport) : undefined;
  const web = await PaseoWeb.launch({ url: daemon.url, viewport, headed: values.headed });
  try {
    if (values.path) {
      await web.gotoRoute(values.path);
    } else {
      const workspaces = daemonJson<WorkspaceEntry[]>(daemon, ["workspace", "ls"]) ?? [];
      const workspace = pickWorkspace(workspaces, values.workspace);
      const serverId = daemonJson<{ serverId?: string }>(daemon, ["status"])?.serverId;
      if (workspace && serverId) {
        await web.openWorkspace(serverId, workspace.workspaceId);
        console.log(`opened workspace ${workspace.name} (${workspace.workspaceId})`);
      } else if (values.workspace) {
        throw new Error(`no workspace matches ${values.workspace}; create one with \`ppd daemon up --workspace <dir>\``);
      } else if (serverId) {
        console.log(noWorkspaceNote(workspaces));
      }
    }
    if (values.command) await web.runCommand(values.command);
    for (const label of values.click ?? []) await web.click(label);
    await web.page.waitForTimeout(values.wait ? Number(values.wait) : 1500);
    if (values.shot) console.log(`screenshot: ${await web.shot(values.shot, values["full-page"])}`);
    if (values.headed && !values.shot) {
      console.log("browser open; press Ctrl+C to close");
      await new Promise<void>((resolveClose) => web.page.on("close", () => resolveClose()));
    }
    const consoleErrors = web.errors.filter((error) => !error.startsWith("[Plugins] Failed to evaluate"));
    console.log(consoleErrors.length ? `console errors:\n  ${consoleErrors.join("\n  ")}` : "console errors: none");
    if (web.pluginErrors.length) {
      console.log(`plugin clients that failed to evaluate (the app shows none of their UI):\n  ${web.pluginErrors.join("\n  ")}`);
      return 1;
    }
    console.log("plugin evaluation errors: none");
    return 0;
  } finally {
    await web.close().catch(() => {});
  }
}

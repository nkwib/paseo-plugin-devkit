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

export interface FileOpenOptions {
  /** Answer an expected panel picker with this unique title or full host label. Omit for a saved association. */
  panel?: string;
  /** Remember the panel choice when the host shows its picker. */
  remember?: boolean;
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

function panelName(panel: string): RegExp {
  const escaped = panel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?: \\u2014 .+)?$`);
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
    try {
      await web.gotoRoute("/");
      return web;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
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

  /** Open the host's Files tree in the current workspace. */
  async openFiles(): Promise<void> {
    const browse = this.page.getByRole("button", { name: "Browse workspace files", exact: true });
    const sidebar = this.page.getByRole("button", { name: "Open Explorer sidebar", exact: true });
    // After a reload the restored sidebar mounts after the app shell: wait for either control before choosing.
    await waitForUi(browse.or(sidebar).first(), 'the Files button or an "Open Explorer sidebar" button', 30_000);
    if (!(await browse.isVisible())) await sidebar.click();
    await browse.click();
  }

  /** A native file tab, whose accessible name is the workspace-relative path. */
  fileTab(path: string): Locator {
    return this.page.getByRole("button", { name: path, exact: true });
  }

  private async fileRow(path: string, timeout = 30_000): Promise<Locator> {
    // Paseo's tree is a flat, virtualized list: row ids are flat indices, indentation supplies ancestry, and only rows
    // near the viewport exist. Scan from the top, remembering rows by index, so ancestry survives scrolling and a
    // basename never matches the same name in another folder.
    const deadline = Date.now() + timeout;
    const rows = new Map<number, { indent: number; name: string }>();
    let fromTop = true;
    for (;;) {
      if (fromTop) {
        rows.clear();
        await this.scrollFiles("top");
      }
      const view: { seen: [number, number, string][]; end: boolean } | null = await this.page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('[data-testid="file-explorer-tree-scroll"]');
        if (!scroller) return null;
        const seen: [number, number, string][] = [];
        for (const row of scroller.querySelectorAll<HTMLElement>('[data-testid^="file-explorer-row-"]')) {
          const index = /^file-explorer-row-(\d+)$/.exec(row.dataset.testid ?? "")?.[1];
          const name = row.querySelector('[data-testid$="-name"]')?.textContent;
          if (index !== undefined && name) seen.push([Number(index), Number.parseFloat(getComputedStyle(row).paddingLeft), name]);
        }
        return { seen, end: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 };
      });
      for (const [index, indent, name] of view?.seen ?? []) rows.set(index, { indent, name });
      const parents: { indent: number; name: string }[] = [];
      for (let index = 0; rows.has(index); index++) {
        const { indent, name } = rows.get(index)!;
        while (parents.length && parents.at(-1)!.indent >= indent) parents.pop();
        if ([...parents.map((parent) => parent.name), name].join("/") === path) return this.page.getByTestId(`file-explorer-row-${index}`);
        parents.push({ indent, name });
      }
      if (Date.now() > deadline) {
        throw new Error(
          `the Paseo Files tree did not list ${path} within ${timeout / 1000} s. Check that the file exists in the workspace. ppd reads the tree of the Paseo ${VERIFIED_PASEO} web UI; a different version may have changed it (please report it at ${ISSUES_URL})`,
        );
      }
      // Past the end, or before the tree mounts, start over: the listing may still be loading.
      fromTop = !view || view.end;
      if (fromTop) await this.page.waitForTimeout(250);
      else await this.scrollFiles("down");
    }
  }

  /** Scroll the Files tree and give the virtualized list a moment to render the new rows. */
  private async scrollFiles(to: "top" | "down"): Promise<void> {
    await this.page.evaluate((to) => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="file-explorer-tree-scroll"]');
      if (scroller) scroller.scrollTop = to === "top" ? 0 : scroller.scrollTop + scroller.clientHeight / 2;
    }, to);
    await this.page.waitForTimeout(50);
  }

  /** Open a workspace-relative path through the real Files tree, never through plugin navigation. */
  async openFile(path: string, options: FileOpenOptions = {}): Promise<Locator> {
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..") || path.includes("\\") || /^[a-z]:/i.test(path)) {
      throw new UsageError("file path must be workspace-relative, with / separators and no . or .. segments");
    }
    if (await this.fileTab(path).isVisible()) {
      await this.fileTab(path).click();
      return this.fileTab(path);
    }
    await this.openFiles();
    for (let index = 0; index < parts.length - 1; index++) {
      const folder = await this.fileRow(parts.slice(0, index + 1).join("/"));
      await folder.click({ button: "right" });
      await this.page.getByRole("menuitem", { name: "Copy relative path", exact: true }).waitFor({ state: "visible" });
      const expanded = await this.page.getByRole("menuitem", { name: "Collapse folder", exact: true }).isVisible();
      await this.page.keyboard.press("Escape");
      if (!expanded) await folder.click();
    }
    await (await this.fileRow(path)).dblclick();
    // The tab can mount before the file metadata and picker arrive. Wait for the actual radio,
    // rather than treating an early tab as evidence that a saved association bypassed the picker.
    if (options.panel) await this.chooseFilePanel(options.panel, options.remember);
    const tab = this.fileTab(path);
    await waitForUi(tab, `file tab ${path}`, 30_000);
    return tab;
  }

  /**
   * Answer Paseo's panel picker. Fails within `timeoutMs` when no picker appears (a saved association or a single
   * matching panel opens the file directly); change a saved association with openWith instead.
   */
  async chooseFilePanel(panel: string, remember = false, timeoutMs = 10_000): Promise<void> {
    const dialog = this.page.getByRole("dialog").filter({ has: this.page.getByRole("radio") });
    try {
      await dialog.first().waitFor({ timeout: timeoutMs });
    } catch (error) {
      if ((error as Error).name !== "TimeoutError") throw error;
      throw new Error(
        `no panel picker appeared within ${timeoutMs / 1000} s, so "${panel}" was not chosen: the file opens directly with a saved association or its only panel. Omit the panel (--with), or switch panels with openWith`,
        { cause: error },
      );
    }
    const radio = dialog.getByRole("radio", { name: panelName(panel) });
    if ((await radio.count()) === 0) {
      const offered = await dialog.getByRole("radio").evaluateAll((radios) => radios.map((radio) => radio.getAttribute("aria-label") ?? radio.textContent?.trim() ?? ""));
      throw new Error(`the panel picker offers no panel named "${panel}"; it offers: ${offered.join(", ")}`);
    }
    await radio.click();
    await dialog.getByRole("checkbox", { name: "Don't ask me again", exact: true }).setChecked(remember);
    await dialog.getByRole("button", { name: "Use", exact: true }).click();
  }

  /** Select a panel in the native tab menu, using a unique title or full host label. */
  async openWith(name: string, panel: string): Promise<void> {
    await this.fileTab(name).click({ button: "right" });
    await this.page.getByRole("menuitem", { name: "Open with…", exact: true }).hover();
    await this.page.getByRole("menuitem", { name: panelName(panel) }).click();
  }

  /** Keep a preview tab open when another file is opened. */
  async pinFile(name: string): Promise<void> {
    await this.fileTab(name).dblclick();
  }

  async closeFile(name: string): Promise<void> {
    const tab = this.fileTab(name);
    await tab.hover();
    await tab.locator("..").getByRole("button", { name: "Close", exact: true }).click();
    await tab.waitFor({ state: "detached" });
  }

  /** Reload the actual app, preserving browser storage and the host's restored tabs. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.ready();
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
      "open-file": { type: "string" },
      with: { type: "string" },
    },
    strict: true,
  });
  if (values.wait !== undefined && !/^\d+$/.test(values.wait)) throw new UsageError(`--wait must be milliseconds, got ${values.wait}`);
  if (values.with && !values["open-file"]) throw new UsageError("--with requires --open-file");
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
    if (values["open-file"]) await web.openFile(values["open-file"], { panel: values.with });
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

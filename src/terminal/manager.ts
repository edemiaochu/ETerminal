import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Settings } from "../settings";
import type { ShellProfile, PtyExitInfo } from "../types";
import type { ParseResult, TerminalLineInput } from "../ai/parser";
import { basename, isHomePath } from "../ui/dom";
import { xtermOptions, xtermTheme } from "./theme";
import { icon } from "../ui/icons";

export type TabStatus = "starting" | "running" | "exited" | "error";

export interface TerminalTab {
  id: string;
  ptyId: string | null;
  profile: ShellProfile;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  webgl: WebglAddon | null;
  pane: HTMLElement;
  host: HTMLElement;
  loading: HTMLElement;
  exitBanner: HTMLElement;
  title: string;
  terminalTitle: string | null;
  cwd: string;
  branch: string | null;
  status: TabStatus;
  exitCode: number | null;
  aiDetected: boolean;
  aiResult: ParseResult | null;
  createdAt: number;
  lastActiveAt: number;
  gitToken: number;
  copyTimer: number | undefined;
  closed: boolean;
}

export interface TerminalManagerHooks {
  onTabsChanged(): void;
  onActiveChanged(tab: TerminalTab | null): void;
  onTabUpdated(tab: TerminalTab): void;
  notify(message: string, tone?: "info" | "success" | "warning" | "error" | "ai"): void;
}

interface CreateTabOptions {
  profileId?: string;
  cwd?: string;
  activate?: boolean;
}

const MAX_WEBGL_TABS = 8;

export class TerminalManager {
  readonly tabs: TerminalTab[] = [];
  active: TerminalTab | null = null;

  private readonly stage: HTMLElement;
  private settings: Settings;
  private readonly profiles: ShellProfile[];
  private readonly hooks: TerminalManagerHooks;
  private readonly home: string;
  private readonly resizeObserver: ResizeObserver;
  private readonly tabByHost = new WeakMap<Element, TerminalTab>();
  private fitFrame = 0;
  private destroyed = false;

  constructor(options: {
    stage: HTMLElement;
    settings: Settings;
    profiles: ShellProfile[];
    home: string;
    hooks: TerminalManagerHooks;
  }) {
    this.stage = options.stage;
    this.settings = options.settings;
    this.profiles = options.profiles;
    this.home = options.home;
    this.hooks = options.hooks;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const tab = this.tabByHost.get(entry.target);
        if (tab && tab === this.active) this.scheduleFit();
      }
    });
  }

  get activeProfileId(): string | undefined {
    return this.active?.profile.id;
  }

  private nextId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random()}`;
  }

  private normalizeProfile(profileId?: string): ShellProfile {
    const preferred =
      profileId ||
      this.settings.defaultProfile ||
      this.active?.profile.id ||
      (navigator.platform.toLowerCase().includes("win") ? "powershell" : "bash");
    return (
      this.profiles.find((profile) => profile.id === preferred) ||
      this.profiles.find((profile) => profile.id === "powershell") ||
      this.profiles.find((profile) => profile.id === "git-bash") ||
      this.profiles[0]
    );
  }

  private inheritCwd(profile: ShellProfile): string | undefined {
    const current = this.active?.cwd;
    if (!current) return undefined;
    if (profile.kind === "wsl") return current;
    if (!/^[a-zA-Z]:[\\/]/u.test(current) && !current.startsWith("\\\\")) return undefined;
    return current;
  }

  async createTab(options: CreateTabOptions = {}): Promise<TerminalTab | null> {
    if (this.destroyed) return null;
    const profile = this.normalizeProfile(options.profileId);
    if (!profile) {
      this.hooks.notify("没有可用的 shell", "error");
      return null;
    }

    const id = this.nextId();
    const now = Date.now();

    const pane = document.createElement("section");
    pane.className = "terminal-pane is-active";
    pane.dataset.tabId = id;
    pane.setAttribute("role", "tabpanel");

    const host = document.createElement("div");
    host.className = "xterm-host";

    const loading = document.createElement("div");
    loading.className = "pane-loading";
    loading.innerHTML = `<span class="pane-loading__spinner"></span>
      <span class="pane-loading__copy"><strong></strong><span>正在启动 ${profile.name} 会话</span></span>`;
    const loadingTitle = loading.querySelector("strong");
    if (loadingTitle) loadingTitle.textContent = profile.name;

    const exitBanner = document.createElement("div");
    exitBanner.className = "pane-exit";
    exitBanner.hidden = true;
    exitBanner.innerHTML = `<div class="exit-card">
      <span class="exit-card__icon">${icon("alert", 17)}</span>
      <div class="exit-card__copy">
        <strong>会话已结束</strong>
        <span class="exit-card__detail"></span>
      </div>
      <div class="exit-card__actions">
        <button type="button" class="soft-button" data-action="restart">${icon("rotate", 14)}<span>重新启动</span></button>
        <button type="button" class="soft-button" data-action="new">${icon("plus", 14)}<span>新建标签</span></button>
      </div>
    </div>`;

    pane.append(host, loading, exitBanner);
    this.stage.append(pane);

    const term = new Terminal(xtermOptions(this.settings));
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void window.eterm.openExternal(uri);
      }),
    );

    const tab: TerminalTab = {
      id,
      ptyId: null,
      profile,
      term,
      fit,
      search,
      webgl: null,
      pane,
      host,
      loading,
      exitBanner,
      title: profile.name,
      terminalTitle: null,
      cwd: options.cwd || this.inheritCwd(profile) || "",
      branch: null,
      status: "starting",
      exitCode: null,
      aiDetected: false,
      aiResult: null,
      createdAt: now,
      lastActiveAt: now,
      gitToken: 0,
      copyTimer: undefined,
      closed: false,
    };

    this.tabByHost.set(host, tab);
    this.resizeObserver.observe(host);

    term.onData((data) => {
      if (tab.ptyId) window.eterm.writePty(tab.ptyId, data);
    });
    term.onResize(({ cols, rows }) => {
      if (tab.ptyId) window.eterm.resizePty(tab.ptyId, cols, rows);
      this.hooks.onTabUpdated(tab);
    });
    term.onTitleChange((title) => {
      const cleaned = title.replace(/\s+/gu, " ").trim();
      if (!cleaned) return;
      // PowerShell/ConPTY often sets the title to the executable path, and Git
      // Bash sets MSYS context paths. Neither makes a useful tab label.
      if (
        /\.exe\b/iu.test(cleaned) ||
        /^(?:MINGW|MSYS|UCRT64|CLANG64)\b/iu.test(cleaned) ||
        /^[A-Za-z]:[\\/]/u.test(cleaned) ||
        (cleaned.startsWith("/") && !cleaned.startsWith("~/"))
      ) {
        tab.terminalTitle = null;
      } else {
        tab.terminalTitle = cleaned.slice(0, 80);
      }
      this.refreshTitle(tab);
    });
    term.onSelectionChange(() => {
      if (!this.settings.copyOnSelect || !term.hasSelection()) return;
      window.clearTimeout(tab.copyTimer);
      tab.copyTimer = window.setTimeout(() => {
        if (term.hasSelection()) void window.eterm.clipboardWrite(term.getSelection());
      }, 90);
    });
    term.onBell(() => {
      tab.pane.classList.remove("is-bell");
      void tab.pane.offsetWidth;
      tab.pane.classList.add("is-bell");
      window.setTimeout(() => tab.pane.classList.remove("is-bell"), 450);
    });

    term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
      if (cwd) this.updateCwd(tab, cwd);
      return true;
    });

    // Ctrl/Cmd+C copies a live selection, otherwise it reaches the shell as ^C.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const copyChord =
        (event.ctrlKey && !event.shiftKey && !event.altKey) ||
        (event.metaKey && navigator.platform.toLowerCase().includes("mac"));
      if (copyChord && event.key.toLowerCase() === "c" && term.hasSelection()) {
        void window.eterm.clipboardWrite(term.getSelection());
        event.preventDefault();
        return false;
      }
      return true;
    });

    host.addEventListener("pointerdown", (event) => {
      if (event.button === 0) this.focus(tab);
      requestAnimationFrame(() => this.syncImeAnchor(tab));
    });

    // IME anchor workaround: Windows places its candidate window against the
    // hidden textarea. If the user clicks/focuses without moving the cursor,
    // the textarea can still be off-screen and the candidate window appears far
    // from the prompt. Re-sync it before composition starts.
    const textarea = term.textarea;
    if (textarea) {
      textarea.addEventListener("focus", () => {
        requestAnimationFrame(() => this.syncImeAnchor(tab));
      });
      textarea.addEventListener(
        "compositionstart",
        () => {
          this.syncImeAnchor(tab, true);
          requestAnimationFrame(() => this.syncImeAnchor(tab, true));
        },
        true,
      );
      textarea.addEventListener(
        "compositionupdate",
        () => requestAnimationFrame(() => this.syncImeAnchor(tab, true)),
        true,
      );
    }
    host.addEventListener("contextmenu", (event) => {
      // The app-level context menu is wired by the renderer.
      event.preventDefault();
    });

    exitBanner.querySelector('[data-action="restart"]')?.addEventListener("click", () => {
      void this.restart(tab);
    });
    exitBanner.querySelector('[data-action="new"]')?.addEventListener("click", () => {
      void this.createTab();
    });

    this.tabs.push(tab);
    term.open(host);
    this.setActive(tab, { focus: false });
    this.hooks.onTabsChanged();
    this.fitActive();

    await this.nextFrame();
    this.fitTab(tab);

    const cwdToUse = options.cwd ?? this.inheritCwdForTab(tab, profile);
    await this.spawn(tab, cwdToUse);

    if (options.activate !== false) {
      this.setActive(tab, { focus: true });
    }
    return tab;
  }

  private inheritCwdForTab(tab: TerminalTab, profile: ShellProfile): string | undefined {
    if (tab.cwd) return tab.cwd;
    return this.inheritCwd(profile);
  }

  private async spawn(tab: TerminalTab, cwd?: string): Promise<void> {
    tab.status = "starting";
    tab.exitCode = null;
    tab.exitBanner.hidden = true;
    tab.loading.hidden = false;
    tab.pane.classList.remove("is-exited");
    this.hooks.onTabUpdated(tab);

    const cols = Math.max(2, tab.term.cols || 100);
    const rows = Math.max(1, tab.term.rows || 30);
    const clientId = crypto.randomUUID
      ? crypto.randomUUID()
      : `pty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    // Known before invoking so the very first prompt bytes are never dropped.
    tab.ptyId = clientId;
    try {
      const session = await window.eterm.createPty({
        profileId: tab.profile.id,
        cwd,
        cols,
        rows,
        clientId,
      });
      if (tab.closed || tab.ptyId !== clientId) {
        // Tab was closed/restarted while spawning.
        window.eterm.killPty(session.id);
        return;
      }
      tab.cwd = session.cwd || tab.cwd;
      tab.status = "running";
      this.refreshTitle(tab);
      // Keep the frameless loader visible until the first prompt bytes arrive.
      // If a shell never emits anything, retire it after a short fallback.
      window.setTimeout(() => {
        if (!tab.closed && tab.status === "running") tab.loading.hidden = true;
      }, 2400);
      this.updateCwd(tab, tab.cwd, true);
      this.hooks.onTabUpdated(tab);
    } catch (error) {
      if (tab.ptyId === clientId) tab.ptyId = null;
      tab.status = "error";
      tab.loading.hidden = true;
      tab.exitCode = null;
      tab.exitBanner.hidden = false;
      const detail = tab.exitBanner.querySelector(".exit-card__detail");
      if (detail) detail.textContent = String(error instanceof Error ? error.message : error);
      tab.exitBanner.classList.add("is-error");
      this.hooks.onTabUpdated(tab);
      this.hooks.notify(`无法启动 ${tab.profile.name}`, "error");
    }
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  handleData(id: string, data: string): void {
    const tab = this.findByPty(id);
    if (!tab) return;
    tab.lastActiveAt = Date.now();
    if (tab.status === "starting") {
      tab.status = "running";
      this.hooks.onTabUpdated(tab);
    }
    // Data can arrive before the createPty invoke resolves; hide the overlay
    // unconditionally instead of only during the "starting" transition.
    if (!tab.loading.hidden) tab.loading.hidden = true;
    // xterm has its own write queue. Writing immediately keeps echo/backspace
    // latency low; an extra rAF here made fast editing feel laggy.
    tab.term.write(data);
  }

  handleExit(id: string, info: PtyExitInfo): void {
    const tab = this.findByPty(id);
    if (!tab) return;
    tab.ptyId = null;
    tab.status = "exited";
    tab.exitCode = info.exitCode;
    tab.loading.hidden = true;
    tab.exitBanner.hidden = false;
    tab.exitBanner.classList.toggle("is-error", info.exitCode !== 0);
    tab.pane.classList.add("is-exited");
    const detail = tab.exitBanner.querySelector(".exit-card__detail");
    if (detail) {
      detail.textContent =
        info.exitCode === 0
          ? "退出代码 0 · 输出仍保留在缓冲区"
          : `退出代码 ${info.exitCode}${info.signal ? ` · signal ${info.signal}` : ""}`;
    }
    this.hooks.onTabUpdated(tab);
  }

  findByPty(id: string): TerminalTab | undefined {
    return this.tabs.find((tab) => tab.ptyId === id);
  }

  findById(id: string): TerminalTab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  activate(id: string, options: { focus?: boolean } = {}): void {
    const tab = this.findById(id);
    if (!tab) return;
    this.setActive(tab, { focus: options.focus !== false });
  }

  activateIndex(index: number): void {
    const tab = this.tabs[index];
    if (tab) this.setActive(tab, { focus: true });
  }

  cycle(direction: 1 | -1): void {
    if (this.tabs.length < 2 || !this.active) return;
    const index = this.tabs.indexOf(this.active);
    const next = this.tabs[(index + direction + this.tabs.length) % this.tabs.length];
    this.setActive(next, { focus: true });
  }

  private setActive(tab: TerminalTab, options: { focus?: boolean } = {}): void {
    if (this.active === tab && tab.pane.classList.contains("is-active")) {
      if (options.focus) this.focus(tab);
      return;
    }
    this.active = tab;
    tab.lastActiveAt = Date.now();
    for (const item of this.tabs) {
      item.pane.classList.toggle("is-active", item === tab);
    }
    if (tab.term.element) this.ensureWebgl(tab);
    this.scheduleFit(tab);
    this.hooks.onActiveChanged(tab);
    if (options.focus) {
      requestAnimationFrame(() => {
        this.fitTab(tab);
        tab.term.focus();
      });
    }
  }

  ensureWebgl(tab: TerminalTab): void {
    if (tab.webgl || tab.status === "exited") return;
    const loaded = this.tabs.filter((item) => item.webgl).length;
    if (loaded >= MAX_WEBGL_TABS) return;
    try {
      const webgl = new WebglAddon(true);
      webgl.onContextLoss(() => {
        try {
          webgl.dispose();
        } catch {
          /* ignore */
        }
        tab.webgl = null;
      });
      tab.term.loadAddon(webgl);
      tab.webgl = webgl;
    } catch {
      // DOM renderer is fine as a fallback (software WebGL, RDP, VM…).
      tab.webgl = null;
    }
  }

  scheduleFit(tab: TerminalTab | null = this.active): void {
    if (!tab) return;
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => {
      if (tab !== this.active || tab.status === "exited" || tab.pane.offsetParent === null) return;
      this.fitTab(tab);
    });
  }

  fitActive(): void {
    if (this.active) this.fitTab(this.active);
  }

  private fitTab(tab: TerminalTab): void {
    try {
      tab.fit.fit();
      if (tab.webgl) tab.webgl.clearTextureAtlas();
      requestAnimationFrame(() => this.syncImeAnchor(tab));
    } catch {
      /* host may be hidden or zero-sized */
    }
  }

  /**
   * xterm's composition helper is private, but its textarea/candidate anchor
   * is what Windows IME uses. Keep it aligned with the cursor before and
   * during composition; guarded because these internals are not public API.
   */
  private syncImeAnchor(tab: TerminalTab, composing = false): void {
    if (composing) {
      try {
        tab.term.scrollToBottom();
      } catch {
        /* ignore */
      }
    }
    const core = tab.term as unknown as {
      _syncTextArea?: () => void;
      _compositionHelper?: {
        isComposing?: boolean;
        updateCompositionElements?: (force?: boolean) => void;
      };
    };
    try {
      if (composing || core._compositionHelper?.isComposing) {
        core._compositionHelper?.updateCompositionElements?.(true);
      } else {
        core._syncTextArea?.();
      }
    } catch {
      /* private API — a failure must never break input */
    }
    this.pinImeAnchorToCursor(tab);
  }

  /**
   * xterm computes the IME anchor from its own cell metrics. Under a nested
   * workbench layout, WIndows can occasionally show the candidate window far
   * from the prompt. Recompute the anchor from real bounding rects so the
   * hidden textarea always sits exactly on the cursor cell.
   */
  private pinImeAnchorToCursor(tab: TerminalTab): void {
    const term = tab.term;
    const element = term.element;
    const textarea = term.textarea;
    if (!element || !textarea) return;
    const helpers = element.querySelector<HTMLElement>(".xterm-helpers");
    const screen = element.querySelector<HTMLElement>(".xterm-screen");
    if (!helpers || !screen) return;

    try {
      const helpersRect = helpers.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const cols = Math.max(1, term.cols);
      const rows = Math.max(1, term.rows);
      const cellWidth = screenRect.width / cols;
      const cellHeight = screenRect.height / rows;
      const buffer = term.buffer.active;
      const x = Math.max(0, Math.min(cols - 1, buffer.cursorX));
      const y = Math.max(0, Math.min(rows - 1, buffer.cursorY));
      const left = screenRect.left - helpersRect.left + x * cellWidth;
      const top = screenRect.top - helpersRect.top + y * cellHeight;

      textarea.style.left = `${left}px`;
      textarea.style.top = `${top}px`;
      textarea.style.width = `${Math.max(1, cellWidth)}px`;
      textarea.style.height = `${Math.max(1, cellHeight)}px`;
      textarea.style.lineHeight = `${cellHeight}px`;

      const compositionView = element.querySelector<HTMLElement>(".composition-view");
      if (compositionView) {
        compositionView.style.left = `${left}px`;
        compositionView.style.top = `${top}px`;
      }
    } catch {
      /* layout may be unavailable while a tab is hidden */
    }
  }

  focus(tab: TerminalTab | null = this.active): void {
    if (!tab) return;
    if (this.active !== tab) this.setActive(tab, { focus: false });
    tab.term.focus();
  }

  refreshTitle(tab: TerminalTab): void {
    const shellTitle = tab.terminalTitle?.trim();
    const folder = tab.cwd && !isHomePath(tab.cwd, this.home) ? basename(tab.cwd) : "";
    let next = tab.profile.name;
    if (shellTitle) next = shellTitle;
    else if (folder) next = folder;
    if (next !== tab.title) {
      tab.title = next;
      this.hooks.onTabsChanged();
    } else {
      this.hooks.onTabUpdated(tab);
    }
  }

  private updateCwd(tab: TerminalTab, cwd: string, force = false): void {
    if (!cwd) return;
    if (!force && tab.cwd === cwd) return;
    tab.cwd = cwd;
    this.refreshTitle(tab);
    const token = ++tab.gitToken;
    tab.branch = null;
    void window.eterm.gitBranch(cwd).then((branch) => {
      if (token !== tab.gitToken || this.destroyed) return;
      tab.branch = branch;
      this.hooks.onTabUpdated(tab);
    });
    this.hooks.onTabUpdated(tab);
  }

  async closeTab(id: string, options: { ensureOne?: boolean } = {}): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    const wasActive = tab === this.active;
    tab.closed = true;

    if (tab.ptyId) {
      window.eterm.killPty(tab.ptyId);
      tab.ptyId = null;
    }
    this.resizeObserver.unobserve(tab.host);
    try {
      tab.webgl?.dispose();
    } catch {
      /* ignore */
    }
    tab.webgl = null;
    tab.term.dispose();
    tab.pane.remove();
    this.tabs.splice(index, 1);

    if (wasActive) {
      this.active = null;
      const next = this.tabs[Math.min(index, this.tabs.length - 1)] || null;
      if (next) this.setActive(next, { focus: true });
    }

    this.hooks.onTabsChanged();
    this.hooks.onActiveChanged(this.active);

    if (this.tabs.length === 0 && options.ensureOne !== false) {
      await this.createTab();
    }
  }

  async closeActive(): Promise<void> {
    if (this.active) await this.closeTab(this.active.id);
  }

  async restart(tab: TerminalTab | null = this.active): Promise<void> {
    if (!tab) return;
    if (tab.ptyId) {
      window.eterm.killPty(tab.ptyId);
      tab.ptyId = null;
    }
    tab.term.reset();
    tab.aiDetected = false;
    tab.aiResult = null;
    tab.terminalTitle = null;
    tab.title = tab.profile.name;
    tab.exitBanner.hidden = true;
    tab.exitBanner.classList.remove("is-error");
    tab.loading.hidden = false;
    tab.pane.classList.remove("is-exited");
    tab.createdAt = Date.now();
    this.scheduleFit(tab);
    await this.spawn(tab, tab.cwd);
    this.hooks.onTabsChanged();
    this.focus(tab);
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    for (const tab of this.tabs) {
      tab.term.options.theme = xtermTheme(settings);
      tab.term.options.fontFamily = xtermOptions(settings).fontFamily;
      tab.term.options.fontSize = settings.fontSize;
      tab.term.options.lineHeight = settings.lineHeight;
      tab.term.options.cursorStyle = settings.cursorStyle;
      tab.term.options.cursorBlink = settings.cursorBlink;
      if (tab.webgl) tab.webgl.clearTextureAtlas();
      this.scheduleFit(tab);
    }
    this.scheduleFit();
  }

  getActiveLines(limit = 600, preferSelection = false): { lines: TerminalLineInput[]; selected: boolean } {
    const tab = this.active;
    if (!tab) return { lines: [], selected: false };

    if (preferSelection && tab.term.hasSelection()) {
      const selection = tab.term.getSelection();
      if (selection.trim()) {
        return {
          lines: selection.split(/\r?\n/u).map((text) => ({ text })),
          selected: true,
        };
      }
    }

    const buffer = tab.term.buffer.active;
    const end = Math.min(buffer.length, buffer.baseY + tab.term.rows);
    const start = Math.max(0, end - limit);
    const lines: TerminalLineInput[] = [];
    for (let i = start; i < end; i += 1) {
      const line = buffer.getLine(i);
      if (!line) continue;
      lines.push({ text: line.translateToString(true), wrapped: line.isWrapped });
    }
    // Trim trailing empty lines but keep the internal layout.
    while (lines.length > 0 && !lines[lines.length - 1].text.trim()) lines.pop();
    return { lines, selected: false };
  }

  getActiveSelection(): string {
    return this.active?.term.getSelection() || "";
  }

  hasSelection(): boolean {
    return this.active?.term.hasSelection() ?? false;
  }

  writeToActive(text: string): void {
    if (this.active?.ptyId) window.eterm.writePty(this.active.ptyId, text);
  }

  runInActive(command: string): void {
    if (!this.active) return;
    this.focus(this.active);
    this.writeToActive(`${command}\r`);
  }

  /** Write directly into the terminal display (used by the built-in demo). */
  writeDisplay(text: string): void {
    const tab = this.active;
    if (!tab) return;
    tab.loading.hidden = true;
    tab.term.write(text);
    this.hooks.onTabUpdated(tab);
  }

  clearActive(): void {
    if (!this.active) return;
    this.writeToActive("\x0c");
    this.focus(this.active);
  }

  async copySelection(): Promise<boolean> {
    const text = this.getActiveSelection();
    if (!text) return false;
    await window.eterm.clipboardWrite(text);
    return true;
  }

  async paste(): Promise<boolean> {
    if (!this.active) return false;
    const text = await window.eterm.clipboardRead();
    if (!text) return false;
    this.active.term.paste(text);
    this.focus(this.active);
    return true;
  }

  selectAll(): void {
    if (!this.active) return;
    this.active.term.selectAll();
    this.focus(this.active);
  }

  dispose(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.fitFrame);
    for (const tab of this.tabs) {
      if (tab.ptyId) window.eterm.killPty(tab.ptyId);
      try {
        tab.webgl?.dispose();
      } catch {
        /* ignore */
      }
      tab.term.dispose();
    }
    this.tabs.length = 0;
    this.active = null;
  }
}

function parseOsc7(data: string): string | null {
  let value = data.trim();
  if (!value) return null;
  if (value.startsWith("file://")) value = value.slice("file://".length);
  try {
    value = decodeURI(value);
  } catch {
    /* keep raw */
  }
  if (/^\/[A-Za-z]:[\\/]/u.test(value)) {
    return value.slice(1).replace(/\//gu, "\\");
  }
  if (/^[A-Za-z]:[\\/]/u.test(value)) {
    return value.replace(/\//gu, "\\");
  }
  if (value.startsWith("/")) return value;
  const slash = value.indexOf("/");
  if (slash >= 0) return value.slice(slash);
  return value || null;
}

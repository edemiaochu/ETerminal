import "@xterm/xterm/css/xterm.css";
import "./liquid-glass/core.css";
import "./styles.css";
import "./workbench.css";

import { attachGlassSurface, createLiquidGlass, type LiquidGlassController } from "./liquid-glass/vanilla";
import { FONT_STACKS, loadSettings, resetSettings, saveSettings, type Settings } from "./settings";
import { TerminalManager, type TerminalTab } from "./terminal/manager";
import { AiReader } from "./ui/ai-reader";
import { CommandPalette, type PaletteAction } from "./ui/command-palette";
import { SettingsPanel } from "./ui/settings-panel";
import { appMark, icon, type IconName } from "./ui/icons";
import { toast } from "./ui/toast";
import { basename, escapeHtml, formatClock, isHomePath } from "./ui/dom";
import { isAiTranscript } from "./ai/parser";
import {
  createCommandSnippet,
  formatCommandName,
  isDangerousCommand,
  loadCommandSnippets,
  persistCommandSnippets,
  type CommandSnippet,
} from "./commands";
import { demoTranscript } from "./demo";
import { coerceTheme, getTheme, terminalSurfaces, THEMES } from "./themes";
import { themeCardsMarkup } from "./ui/theme-cards";
import type { BootstrapInfo, ShellProfile, WindowState } from "./types";

const isMac = navigator.platform.toLowerCase().includes("mac");
const mod = isMac ? "⌘" : "Ctrl";
const shift = isMac ? "⇧" : "Shift";
const shortcuts = {
  newTab: `${mod}+${shift}+T`,
  closeTab: `${mod}+${shift}+W`,
  palette: `${mod}+${shift}+P`,
  search: `${mod}+${shift}+F`,
  ai: `${mod}+${shift}+A`,
  settings: `${mod}+,`,
  copy: `${mod}+${shift}+C`,
  paste: `${mod}+${shift}+V`,
};

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function prettyCwd(cwd: string, home: string): string {
  if (!cwd) return "~";
  const normalizedHome = home.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  const normalized = cwd.replace(/\\/gu, "/");
  if (normalizedHome && normalized.toLowerCase() === normalizedHome) return "~";
  if (normalizedHome && normalized.toLowerCase().startsWith(`${normalizedHome}/`)) {
    return `~${normalized.slice(normalizedHome.length)}`;
  }
  return normalized;
}

function shellLabel(profile: ShellProfile): string {
  return profile.short;
}

class ETerminalApp {
  private readonly boot: BootstrapInfo;
  private settings: Settings;
  private readonly appUi: HTMLElement;
  private glass: LiquidGlassController | null = null;
  private manager!: TerminalManager;
  private reader!: AiReader;
  private palette!: CommandPalette;
  private settingsPanel!: SettingsPanel;

  private els!: {
    shell: HTMLElement;
    canvas: HTMLCanvasElement;
    toolbar: HTMLElement;
    pathChip: HTMLButtonElement;
    pathChipParent: HTMLElement;
    pathChipName: HTMLElement;
    pathChipBranch: HTMLElement;
    pathChipBranchText: HTMLElement;
    pathChipTooltip: HTMLElement;
    sessionCluster: HTMLElement;
    navCluster: HTMLElement;
    tabBar: HTMLElement;
    tabs: HTMLElement;
    toolbarNewSession: HTMLButtonElement;
    shellSelector: HTMLButtonElement;
    toolbarRestart: HTMLButtonElement;
    toolbarClose: HTMLButtonElement;
    searchButton: HTMLButtonElement;
    sidebarToggle: HTMLButtonElement;
    themeButton: HTMLButtonElement;
    profileMenu: HTMLElement;
    themePopover: HTMLElement;
    aiToggle: HTMLButtonElement;
    paletteButton: HTMLButtonElement;
    snippetsButton: HTMLButtonElement;
    snippetsPopover: HTMLElement;
    settingsButton: HTMLButtonElement;
    winMax: HTMLButtonElement;
    workspace: HTMLElement;
    sessionsSidebar: HTMLElement;
    sidebarCollapse: HTMLButtonElement;
    sidebarSessions: HTMLElement;
    sidebarNewSession: HTMLButtonElement;
    sidebarSessionCount: HTMLElement;
    sidebarPath: HTMLButtonElement;
    sidebarBranch: HTMLButtonElement;
    sidebarAi: HTMLButtonElement;
    sidebarAiStatus: HTMLElement;
    terminalPanel: HTMLElement;
    terminalStage: HTMLElement;
    aiPanel: HTMLElement;
    searchBar: HTMLElement;
    searchInput: HTMLInputElement;
    searchCount: HTMLElement;
    searchCase: HTMLButtonElement;
    searchNext: HTMLButtonElement;
    searchPrev: HTMLButtonElement;
    searchClose: HTMLButtonElement;
    statusProfileText: HTMLElement;
    statusDot: HTMLElement;
    statusAi: HTMLButtonElement;
    statusSize: HTMLElement;
    statusClock: HTMLElement;
    contextMenu: HTMLElement;
  };

  private aiTimer = 0;
  private clockTimer = 0;
  private searchDispose: { dispose(): void } | null = null;
  private contextCleanup: (() => void) | null = null;
  private profileMenuCleanup: (() => void) | null = null;
  private themePopoverCleanup: (() => void) | null = null;
  private themePopoverOpen = false;
  private commands: CommandSnippet[] = [];
  private snippetsCleanup: (() => void) | null = null;
  private snippetsOpen = false;
  private snippetsFormOpen = false;
  private snippetsEditingId: string | null = null;
  private searchCaseSensitive = false;
  private aiNotified = new Set<string>();
  private suppressAiToast = false;

  constructor(boot: BootstrapInfo, settings: Settings, appUi: HTMLElement) {
    this.boot = boot;
    this.settings = settings;
    this.appUi = appUi;
    this.suppressAiToast = Boolean(boot.demo);
    if (!settings.defaultProfile || !boot.profiles.some((profile) => profile.id === settings.defaultProfile)) {
      this.settings.defaultProfile = "";
    }
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--ai-width", `${settings.aiPanelWidth}px`);
    document.documentElement.style.setProperty("--ui-mono", FONT_STACKS[settings.fontChoice]);
    const initialSurfaces = terminalSurfaces(settings.theme);
    document.documentElement.style.setProperty("--term-bg", initialSurfaces.terminal);
    document.documentElement.style.setProperty("--ai-surface", initialSurfaces.aiPanel);
  }

  async start(): Promise<void> {
    this.buildShell();
    this.queryElements();
    this.startGlass();
    await this.loadFonts();
    this.createManager();
    window.eterm.onPtyData((id, data) => this.manager.handleData(id, data));
    window.eterm.onPtyExit((id, info) => this.manager.handleExit(id, info));
    this.commands = loadCommandSnippets();
    this.createReader();
    this.createPalette();
    this.createSettingsPanel();
    this.applySettings(this.settings, { initial: true });
    this.bindChrome();
    this.bindTabs();
    this.bindTerminalContextMenu();
    this.bindShortcuts();
    this.bindWindowState();
    this.updateClock();
    this.updateStatus();
    this.syncAiButton();
    window.addEventListener("focus", () => this.pollAi(true));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.pollAi(true);
    });

    await this.manager.createTab({
      profileId: this.settings.defaultProfile || undefined,
    });

    this.renderTabs();
    this.updateTopbar();
    this.startTimers();
    document.body.classList.remove("is-booting");
    this.els.shell.classList.remove("is-booting");

    if (this.boot.demo) {
      await this.runDemo(this.boot.demo);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shell                                                              */
  /* ------------------------------------------------------------------ */

  private buildShell(): void {
    this.appUi.innerHTML = `
      <div class="window-shell is-booting" id="window-shell">
        <header class="toolbar" id="toolbar">
          <div class="toolbar-inner">
            <div class="app-brand" title="ETerminal ${escapeHtml(this.boot.version)}">
              <span class="app-brand__mark">${appMark(24)}</span>
              <span class="app-brand__name">ETerminal</span>
              <span class="app-brand__version">v${escapeHtml(this.boot.version)}</span>
            </div>
            <div class="toolbar-cluster lg-surface" id="session-cluster" data-cluster="session">
                <button type="button" class="icon-btn" id="toolbar-new-session" title="新建会话 (${shortcuts.newTab})" aria-label="新建会话">${icon("plus", 18)}</button>
                <button type="button" class="tool-selector" id="shell-selector" title="选择 Shell 新建会话" aria-label="选择 Shell">
                  <span class="tool-selector__icon">${icon("terminal", 18)}</span>
                  <span class="tool-selector__label">新会话</span>
                  ${icon("chevron-down", 14)}
                </button>
                <span class="cluster-divider" aria-hidden="true"></span>
                <button type="button" class="icon-btn" id="toolbar-restart" title="重启当前会话" aria-label="重启当前会话">${icon("rotate", 18)}</button>
                <button type="button" class="icon-btn danger-hover" id="toolbar-close" title="关闭当前标签 (${shortcuts.closeTab})" aria-label="关闭当前标签">${icon("x", 18)}</button>
              </div>
              <div class="toolbar-path-slot">
                <button type="button" class="path-chip" id="path-chip" aria-label="当前路径">
                  <span class="path-chip__icon">${icon("folder", 15)}</span>
                  <span class="path-chip__parent" id="path-chip-parent"></span>
                  <span class="path-chip__name" id="path-chip-name">~</span>
                  <span class="path-chip__branch" id="path-chip-branch" hidden>${icon("git-branch", 12)}<span id="path-chip-branch-text"></span></span>
                  <span class="path-chip__copy">${icon("copy", 12)}</span>
                  <span class="path-chip__tooltip" role="tooltip">
                    <span class="path-chip__tooltip-path" id="path-chip-tooltip">当前路径</span>
                    <span class="path-chip__tooltip-hint">点击复制完整路径</span>
                  </span>
                </button>
              </div>
              <div class="toolbar-cluster lg-surface" id="nav-cluster" data-cluster="tools">
                <button type="button" class="icon-btn" id="palette-button" title="命令面板 (${shortcuts.palette})" aria-label="命令面板">${icon("command", 18)}</button>
                <button type="button" class="icon-btn" id="search-button" title="搜索终端 (${shortcuts.search})" aria-label="搜索终端">${icon("search", 18)}</button>
                <button type="button" class="icon-btn" id="snippets-button" aria-expanded="false" title="常用命令" aria-label="常用命令">${icon("bolt", 18)}</button>
                <span class="cluster-divider" aria-hidden="true"></span>
                <button type="button" class="icon-btn" id="sidebar-toggle" aria-pressed="false" title="显示/收起工作区侧栏" aria-label="显示/收起工作区侧栏">${icon("panel-left", 18)}</button>
                <button type="button" class="icon-btn ai-icon-btn" id="ai-toggle" aria-pressed="false" title="AI 阅读器 (${shortcuts.ai})" aria-label="AI 阅读器">
                  ${icon("sparkles", 18)}<span class="icon-pip" aria-hidden="true"></span>
                </button>
                <span class="cluster-divider" aria-hidden="true"></span>
                <button type="button" class="icon-btn" id="theme-button" title="主题面板" aria-label="主题面板">${icon("palette", 18)}</button>
                <button type="button" class="icon-btn" id="settings-button" title="材质与设置 (${shortcuts.settings})" aria-label="材质与设置">${icon("sliders", 18)}</button>
              </div>
            <div class="win-controls">
              <button type="button" class="win-btn" data-win="minimize" aria-label="最小化" title="最小化">${icon("minus", 14)}</button>
              <button type="button" class="win-btn" id="win-max" data-win="toggle-maximize" aria-label="最大化" title="最大化">${icon("square", 14)}</button>
              <button type="button" class="win-btn win-btn--close" data-win="close" aria-label="关闭" title="关闭">${icon("x", 14)}</button>
            </div>
          </div>
        </header>

        <div class="tab-bar" id="tab-bar">
          <div class="tabs" id="tabs" role="tablist" aria-label="终端会话"></div>
        </div>

        <main class="workspace" id="workspace">
          <aside class="sessions-sidebar" id="sessions-sidebar" aria-label="工作区侧栏" hidden>
            <div class="sessions-sidebar__inner">
              <header class="sidebar-head">
                <div class="sidebar-heading">
                  <span class="sidebar-eyebrow">WORKSPACE</span>
                  <h2>工作区</h2>
                </div>
                <button type="button" class="sidebar-collapse" id="sidebar-collapse" title="收起侧栏" aria-label="收起侧栏">${icon("chevron-left", 15)}</button>
              </header>
              <div class="sidebar-section sidebar-section--sessions">
                <div class="sidebar-section-head"><span>会话</span><span class="sidebar-count" id="sidebar-session-count">0</span></div>
                <div class="sidebar-sessions" id="sidebar-sessions"></div>
                <button type="button" class="sidebar-new-session" id="sidebar-new-session" title="新建会话">${icon("plus", 13)}<span>新建会话</span></button>
              </div>
              <div class="sidebar-location">
                <button type="button" class="sidebar-location__row" id="sidebar-path" title="复制当前目录">${icon("folder", 13)}<span>~</span></button>
                <button type="button" class="sidebar-location__row sidebar-location__branch" id="sidebar-branch" title="复制分支名" hidden>${icon("git-branch", 13)}<span></span></button>
              </div>
              <button type="button" class="sidebar-ai" id="sidebar-ai" title="打开 AI 阅读器">
                <span class="sidebar-ai__orb">${icon("sparkles", 15)}</span>
                <span class="sidebar-ai__copy"><strong>AI 阅读器</strong><em id="sidebar-ai-status">等待 AI 输出</em></span>
                ${icon("chevron-right", 14)}
              </button>
              <div class="sidebar-foot">
                <span><kbd>${mod}</kbd><kbd>${shift}</kbd><kbd>P</kbd></span>
                <span>命令面板</span>
              </div>
            </div>
          </aside>

          <section class="terminal-panel" id="terminal-panel">
            <div class="terminal-stage" id="terminal-stage"></div>
            <div class="search-bar" id="search-bar" hidden>
              <span class="search-bar__icon">${icon("search", 14)}</span>
              <input id="search-input" type="text" placeholder="搜索当前会话…" spellcheck="false" autocomplete="off" aria-label="搜索终端" />
              <span class="search-bar__count" id="search-count"></span>
              <button type="button" class="search-btn" id="search-case" title="区分大小写" aria-pressed="false">Aa</button>
              <button type="button" class="search-btn" id="search-prev" title="上一个 (Shift+Enter)" aria-label="上一个">${icon("chevron-up", 14)}</button>
              <button type="button" class="search-btn" id="search-next" title="下一个 (Enter)" aria-label="下一个">${icon("chevron-down", 14)}</button>
              <button type="button" class="search-btn search-btn--close" id="search-close" title="关闭 (Esc)" aria-label="关闭搜索">${icon("x", 13)}</button>
            </div>
            <footer class="status-bar">
              <span class="status-chip status-chip--profile" title="当前 shell">
                <span class="status-dot" id="status-dot"></span>
                <span id="status-profile-text">Shell</span>
              </span>
              <span class="status-spacer"></span>
              <button type="button" class="status-chip status-chip--ai" id="status-ai" title="打开 AI 阅读器" hidden>
                ${icon("sparkles", 11)}<span>AI 就绪</span>
              </button>
              <span class="status-chip status-chip--muted" id="status-size" title="终端列 × 行">—</span>
              <span class="status-chip status-chip--muted" id="status-clock" title="当前时间">--:--</span>
            </footer>
          </section>

          <aside class="ai-panel" id="ai-panel" hidden aria-label="AI 阅读器"></aside>
        </main>

        <div class="profile-menu" id="profile-menu" hidden></div>
        <div class="theme-popover" id="theme-popover" hidden></div>
        <div class="snippets-popover" id="snippets-popover" hidden></div>
        <div class="context-menu" id="context-menu" hidden></div>
      </div>`;
  }

  private queryElements(): void {
    const q = <T extends Element = HTMLElement>(selector: string): T => {
      const node = document.querySelector<T>(selector);
      if (!node) throw new Error(`Missing shell element: ${selector}`);
      return node;
    };
    this.els = {
      shell: q("#window-shell"),
      canvas: q<HTMLCanvasElement>("#glass-canvas"),
      toolbar: q("#toolbar"),
      pathChip: q<HTMLButtonElement>("#path-chip"),
      pathChipParent: q("#path-chip-parent"),
      pathChipName: q("#path-chip-name"),
      pathChipBranch: q("#path-chip-branch"),
      pathChipBranchText: q("#path-chip-branch-text"),
      pathChipTooltip: q("#path-chip-tooltip"),
      sessionCluster: q("#session-cluster"),
      navCluster: q("#nav-cluster"),
      tabBar: q("#tab-bar"),
      tabs: q("#tabs"),
      toolbarNewSession: q<HTMLButtonElement>("#toolbar-new-session"),
      shellSelector: q<HTMLButtonElement>("#shell-selector"),
      toolbarRestart: q<HTMLButtonElement>("#toolbar-restart"),
      toolbarClose: q<HTMLButtonElement>("#toolbar-close"),
      searchButton: q<HTMLButtonElement>("#search-button"),
      sidebarToggle: q<HTMLButtonElement>("#sidebar-toggle"),
      themeButton: q<HTMLButtonElement>("#theme-button"),
      profileMenu: q("#profile-menu"),
      themePopover: q("#theme-popover"),
      aiToggle: q<HTMLButtonElement>("#ai-toggle"),
      paletteButton: q<HTMLButtonElement>("#palette-button"),
      snippetsButton: q<HTMLButtonElement>("#snippets-button"),
      snippetsPopover: q("#snippets-popover"),
      settingsButton: q<HTMLButtonElement>("#settings-button"),
      winMax: q<HTMLButtonElement>("#win-max"),
      workspace: q("#workspace"),
      sessionsSidebar: q("#sessions-sidebar"),
      sidebarCollapse: q<HTMLButtonElement>("#sidebar-collapse"),
      sidebarSessions: q("#sidebar-sessions"),
      sidebarNewSession: q<HTMLButtonElement>("#sidebar-new-session"),
      sidebarSessionCount: q("#sidebar-session-count"),
      sidebarPath: q<HTMLButtonElement>("#sidebar-path"),
      sidebarBranch: q<HTMLButtonElement>("#sidebar-branch"),
      sidebarAi: q<HTMLButtonElement>("#sidebar-ai"),
      sidebarAiStatus: q("#sidebar-ai-status"),
      terminalPanel: q("#terminal-panel"),
      terminalStage: q("#terminal-stage"),
      aiPanel: q("#ai-panel"),
      searchBar: q("#search-bar"),
      searchInput: q<HTMLInputElement>("#search-input"),
      searchCount: q("#search-count"),
      searchCase: q<HTMLButtonElement>("#search-case"),
      searchNext: q<HTMLButtonElement>("#search-next"),
      searchPrev: q<HTMLButtonElement>("#search-prev"),
      searchClose: q<HTMLButtonElement>("#search-close"),
      statusProfileText: q("#status-profile-text"),
      statusDot: q("#status-dot"),
      statusAi: q<HTMLButtonElement>("#status-ai"),
      statusSize: q("#status-size"),
      statusClock: q("#status-clock"),
      contextMenu: q("#context-menu"),
    };
  }

  private startGlass(): void {
    this.glass = createLiquidGlass({
      canvas: this.els.canvas,
      params: this.settings.glass,
      theme: this.settings.theme === "light" ? "light" : "dark",
      background: this.settings.wallpaper,
      onError: (error) => {
        console.error("[glass] init failed:", error);
        (window as unknown as Record<string, unknown>).__etGlassError = String(error);
        toast("WebGL2 不可用，已切换到 CSS 玻璃降级", { tone: "warning", duration: 5200 });
      },
    });

    // Workbench chrome: clusters float on the aurora; the tab strip and
    // sidebar are flatter glass surfaces; terminal/AI are content cards.
    for (const cluster of [this.els.sessionCluster, this.els.navCluster]) {
      attachGlassSurface(cluster, {
        radius: 16,
        layer: 2,
        tint: "#ffffff",
        tintOpacity: 0.16,
        bevelScale: 0.55,
        thicknessScale: 0.7,
        refractionScale: 1.15,
        interactive: true,
      });
    }
    this.glass?.refresh();
    [80, 350, 1200].forEach((ms) => window.setTimeout(() => this.glass?.refresh(), ms));
  }

  private async loadFonts(): Promise<void> {
    try {
      await document.fonts.load(`${this.settings.fontSize}px "JetBrains Mono"`);
      await document.fonts.ready;
    } catch {
      /* system fallback is fine */
    }
  }

  private createManager(): void {
    this.manager = new TerminalManager({
      stage: this.els.terminalStage,
      settings: this.settings,
      profiles: this.boot.profiles,
      home: this.boot.home,
      hooks: {
        onTabsChanged: () => {
          this.renderTabs();
          this.updateTopbar();
          this.updateStatus();
          this.renderSidebar();
        },
        onActiveChanged: () => {
          this.renderTabs();
          this.updateTopbar();
          this.updateStatus();
          this.renderSidebar();
          this.closeSearch();
          if (this.reader?.isOpen) this.reader.handleTabChange();
        },
        onTabUpdated: (tab) => {
          if (tab === this.manager.active) {
            this.updateStatus();
            this.updateTopbar();
          }
          this.updateTabIndicators();
          this.renderSidebar();
        },
        notify: (message, tone) => toast(message, { tone }),
      },
    });
  }

  private createReader(): void {
    this.reader = new AiReader({
      panel: this.els.aiPanel,
      manager: this.manager,
      settings: this.settings,
      claudeAvailable: this.boot.claude,
      onResize: () => {
        this.manager.fitActive();
        window.setTimeout(() => this.manager.fitActive(), 220);
      },
      onFollowChange: (follow) => {
        this.settings.aiFollow = follow;
        saveSettings(this.settings);
      },
      onWidthChange: (width) => {
        this.settings.aiPanelWidth = width;
        saveSettings(this.settings);
      },
      onNotify: (message, tone) => toast(message, { tone }),
      onRunClaude: () => {
        if (!this.boot.claude) {
          toast("没有在 PATH 中找到 claude 命令", { tone: "warning" });
          return;
        }
        this.manager.runInActive("claude");
        toast("已在当前会话启动 Claude Code", { tone: "ai" });
      },
      onParsed: (result, tab) => {
        const wasDetected = tab.aiDetected;
        tab.aiDetected = result.detected;
        tab.aiResult = result;
        if (!wasDetected && result.detected && this.reader.isOpen) {
          this.aiNotified.add(tab.id);
        }
        this.syncAiButton();
        this.updateTabIndicators();
        this.updateStatus();
        this.renderSidebar();
      },
      onVisibilityChange: (open) => {
        this.syncAiButton();
        this.manager.fitActive();
        window.setTimeout(() => this.manager.fitActive(), 240);
        if (open) {
          this.hideProfileMenu();
          this.hideContextMenu();
          this.aiNotified.add(this.manager.active?.id || "");
        } else {
          this.manager.focus();
        }
      },
    });
  }

  private createPalette(): void {
    this.palette = new CommandPalette({
      host: this.appUi,
      actions: () => this.buildPaletteActions(),
      onClose: () => {
        /* focus restoration handled inside the palette */
      },
    });
  }

  private createSettingsPanel(): void {
    this.settingsPanel = new SettingsPanel({
      host: this.appUi,
      settings: this.settings,
      profiles: this.boot.profiles,
      version: this.boot.version,
      onChange: (next) => this.applySettings(next, { fromPanel: true }),
      onReset: () => {
        const fresh = resetSettings();
        this.applySettings(fresh, { fromPanel: true });
        return fresh;
      },
      onClose: () => this.manager.focus(),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                           */
  /* ------------------------------------------------------------------ */

  private applySettings(next: Settings, options: { initial?: boolean; fromPanel?: boolean } = {}): void {
    const previousTheme = this.settings?.theme;
    this.settings = next;
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.style.setProperty("--ai-width", `${next.aiPanelWidth}px`);
    document.documentElement.style.setProperty("--ui-mono", FONT_STACKS[next.fontChoice]);
    const surfaces = terminalSurfaces(next.theme);
    document.documentElement.style.setProperty("--term-bg", surfaces.terminal);
    document.documentElement.style.setProperty("--ai-surface", surfaces.aiPanel);
    this.glass?.setParams(next.glass);
    this.glass?.setTheme(next.theme === "light" ? "light" : "dark", true);
    this.glass?.setBackground(next.wallpaper);
    this.glass?.setMotion(next.motion);
    this.glass?.refresh();
    if (this.els) {
      this.els.sessionsSidebar.hidden = !next.sidebarOpen;
      this.els.sidebarToggle.classList.toggle("is-active", next.sidebarOpen);
      this.els.sidebarToggle.setAttribute("aria-pressed", String(next.sidebarOpen));
      this.els.workspace.classList.toggle("has-sidebar", next.sidebarOpen);
      this.els.themeButton.title = `主题面板 · 当前：${getTheme(next.theme).name}`;
      this.syncThemePopover(next.theme);
    }
    this.manager?.updateSettings(next);
    this.reader?.applySettings(next);
    if (!options.fromPanel && !options.initial) this.settingsPanel?.setSettings(next);
    saveSettings(next);
    if (previousTheme && previousTheme !== next.theme) {
      this.refreshSearchDecorations();
    }
    this.syncAiButton();
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                               */
  /* ------------------------------------------------------------------ */

  private renderTabs(): void {
    const tabs = this.manager?.tabs || [];
    this.els.tabs.innerHTML = tabs
      .map((tab) => {
        const active = tab === this.manager.active;
        const profile = escapeHtml(tab.profile.name);
        const title = escapeHtml(tab.title);
        const tooltip = `${profile} · ${tab.cwd || "—"}`;
        return `<div class="tab${active ? " is-active" : ""}" data-tab-id="${tab.id}" role="tab" tabindex="${active ? "0" : "-1"}" aria-selected="${active}" title="${tooltip}" data-status="${tab.status}">
          <span class="tab__dot" data-kind="${tab.profile.kind}" data-status="${tab.status}" aria-hidden="true"></span>
          <span class="tab__title">${title}</span>
          <span class="tab__ai" ${tab.aiDetected ? "" : "hidden"} aria-label="检测到 AI 输出">${icon("sparkles", 11)}</span>
          <button type="button" class="tab__close" aria-label="关闭 ${title}" title="关闭标签 (${shortcuts.closeTab})">${icon("x", 12)}</button>
        </div>`;
      })
      .join("");

    const activeNode = this.els.tabs.querySelector<HTMLElement>(".tab.is-active");
    if (activeNode) {
      const list = this.els.tabs;
      const left = activeNode.offsetLeft;
      const right = left + activeNode.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = left - 8;
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 8;
    }
  }

  private updateTabIndicators(): void {
    for (const tab of this.manager?.tabs || []) {
      const node = this.els.tabs.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`);
      if (!node) continue;
      node.dataset.status = tab.status;
      const dot = node.querySelector<HTMLElement>(".tab__dot");
      if (dot) {
        dot.dataset.status = tab.status;
        dot.dataset.kind = tab.profile.kind;
      }
      const ai = node.querySelector<HTMLElement>(".tab__ai");
      if (ai) ai.hidden = !tab.aiDetected;
    }
  }

  private bindTabs(): void {
    this.els.tabs.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const tabNode = target.closest<HTMLElement>("[data-tab-id]");
      if (!tabNode) return;
      const id = tabNode.dataset.tabId;
      if (!id) return;
      if (target.closest(".tab__close")) {
        event.stopPropagation();
        void this.manager.closeTab(id);
        return;
      }
      this.manager.activate(id);
    });

    this.els.tabs.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const tabNode = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-id]");
      const id = tabNode?.dataset.tabId;
      if (id) {
        event.preventDefault();
        void this.manager.closeTab(id);
      }
    });

    this.els.tabs.addEventListener("dblclick", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tab__close")) return;
      const tabNode = target.closest<HTMLElement>("[data-tab-id]");
      const id = tabNode?.dataset.tabId;
      if (!id) return;
      const tab = this.manager.findById(id);
      const titleNode = tabNode?.querySelector<HTMLElement>(".tab__title");
      if (tab && titleNode) this.beginRename(tab, titleNode);
    });

    this.els.tabs.addEventListener("keydown", (event) => {
      const tabNode = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-id]");
      const id = tabNode?.dataset.tabId;
      if (!id) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.manager.activate(id);
      } else if (event.key === "Delete" && !(event.target as HTMLElement).closest("input")) {
        event.preventDefault();
        void this.manager.closeTab(id);
      }
    });
  }

  private beginRename(tab: TerminalTab, titleNode: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "tab__rename";
    input.value = tab.title;
    input.spellcheck = false;
    titleNode.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) {
        const value = input.value.trim().slice(0, 80);
        tab.terminalTitle = value || null;
        this.manager.refreshTitle(tab);
      }
      this.renderTabs();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
  }

  private bindTabsChrome(): void {
    const newDefaultTab = () => {
      this.hideProfileMenu();
      this.hideThemePopover();
      void this.manager.createTab({ profileId: this.settings.defaultProfile || undefined });
    };
    this.els.toolbarNewSession.addEventListener("click", newDefaultTab);
    this.els.shellSelector.addEventListener("click", (event) => {
      event.stopPropagation();
      this.hideThemePopover();
      if (this.els.profileMenu.hidden) this.showProfileMenu(this.els.shellSelector);
      else this.hideProfileMenu();
    });
    this.els.profileMenu.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-profile-id]");
      if (!button) return;
      const profileId = button.dataset.profileId;
      this.hideProfileMenu();
      if (profileId) void this.manager.createTab({ profileId });
    });
  }

  private showProfileMenu(anchor: HTMLElement): void {
    this.hideContextMenu();
    this.hideProfileMenu();
    this.hideThemePopover();
    this.hideSnippetsPopover();
    const menu = this.els.profileMenu;
    const active = this.manager.active;
    menu.innerHTML = `
      <div class="menu-label">新建会话</div>
      ${this.boot.profiles
        .map(
          (profile) => `<button type="button" class="menu-item" data-profile-id="${escapeHtml(profile.id)}">
            <span class="menu-item__badge" data-kind="${profile.kind}">${escapeHtml(shellLabel(profile))}</span>
            <span class="menu-item__body"><span class="menu-item__title">${escapeHtml(profile.name)}</span><span class="menu-item__detail">${escapeHtml(profile.description)}</span></span>
            ${profile.id === this.settings.defaultProfile ? '<span class="menu-item__tag">默认</span>' : profile.id === active?.profile.id ? '<span class="menu-item__tag">当前</span>' : ""}
          </button>`,
        )
        .join("")}
      <div class="menu-foot">${shortcuts.newTab} 新建默认会话</div>`;
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = 304;
    menu.style.width = `${width}px`;
    menu.style.left = "12px";
    menu.style.top = "12px";
    const menuHeight = menu.getBoundingClientRect().height || 300;
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left - 40));
    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - menuHeight - 8);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.classList.add("is-open");

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.contains(target) || anchor.contains(target)) return;
      this.hideProfileMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.hideProfileMenu();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", this.hideProfileMenu);
    this.profileMenuCleanup = () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", this.hideProfileMenu);
    };
  }

  private hideProfileMenu = (): void => {
    if (this.els.profileMenu.hidden) return;
    this.els.profileMenu.classList.remove("is-open");
    this.els.profileMenu.hidden = true;
    this.profileMenuCleanup?.();
    this.profileMenuCleanup = null;
  };

  /* ------------------------------------------------------------------ */
  /* Top bar / status                                                   */
  /* ------------------------------------------------------------------ */

  private updateTopbar(): void {
    const tab = this.manager?.active;
    document.title = tab ? `ETerminal — ${tab.title}` : "ETerminal";
    if (this.els?.toolbarRestart) {
      this.els.toolbarRestart.disabled = !tab;
      this.els.toolbarClose.disabled = !tab;
      this.els.toolbarNewSession.disabled = false;
      const theme = getTheme(this.settings.theme);
      this.els.themeButton.title = `主题面板 · 当前：${theme.name}`;
      const shellLabelNode = this.els.shellSelector.querySelector<HTMLElement>(".tool-selector__label");
      if (shellLabelNode) {
        shellLabelNode.textContent = tab?.profile.name.replace(/^Windows\s+/u, "") || "Shell";
      }
      this.els.sidebarToggle.classList.toggle("is-active", this.settings.sidebarOpen);
      this.els.sidebarToggle.setAttribute("aria-pressed", String(this.settings.sidebarOpen));
      this.els.sessionsSidebar.hidden = !this.settings.sidebarOpen;
      this.els.workspace.classList.toggle("has-sidebar", this.settings.sidebarOpen);
    }
    this.syncAiButton();
  }

  private syncAiButton(): void {
    if (!this.els) return;
    const open = this.reader?.isOpen ?? false;
    const tab = this.manager?.active;
    this.els.aiToggle.classList.toggle("is-active", open);
    this.els.aiToggle.classList.toggle("has-ai", Boolean(tab?.aiDetected));
    this.els.aiToggle.setAttribute("aria-pressed", String(open));
    if (this.els.statusAi) this.els.statusAi.hidden = !tab?.aiDetected;
    this.updateSidebarAiState();
  }

  private updateStatus(): void {
    if (!this.els || !this.manager) return;
    const tab = this.manager.active;
    if (!tab) {
      this.els.statusProfileText.textContent = "无会话";
      this.els.pathChipParent.textContent = "";
      this.els.pathChipParent.hidden = true;
      this.els.pathChipName.textContent = "—";
      this.els.pathChipTooltip.textContent = "当前路径";
      this.els.pathChip.setAttribute("aria-label", "当前路径");
      this.els.pathChipBranch.hidden = true;
      this.els.statusSize.textContent = "—";
      return;
    }
    this.els.statusProfileText.textContent = tab.profile.name;
    this.els.statusDot.dataset.status = tab.status;
    this.els.statusDot.title = tab.status === "running" ? "会话运行中" : tab.status === "starting" ? "正在启动" : tab.status === "exited" ? "会话已结束" : "启动失败";
    const cwd = tab.cwd || "";
    const folder = cwd ? basename(cwd) : "~";
    let parent = "";
    if (cwd) {
      const separator = cwd.includes("\\") ? "\\" : "/";
      const cut = cwd.lastIndexOf(separator);
      if (cut > 0) {
        const raw = cwd.slice(0, cut);
        parent = `${raw.length > 36 ? `…${raw.slice(-35)}` : raw}${separator}`;
      }
    }
    this.els.pathChipParent.textContent = parent;
    this.els.pathChipParent.hidden = !parent;
    this.els.pathChipName.textContent = folder || "~";
    this.els.pathChipTooltip.textContent = tab.cwd || "~";
    this.els.pathChip.setAttribute("aria-label", `当前路径：${tab.cwd || "~"}。点击复制`);
    this.els.pathChipBranch.hidden = !tab.branch;
    if (tab.branch) {
      this.els.pathChipBranchText.textContent = tab.branch;
      this.els.pathChipBranch.title = `Git 分支：${tab.branch}`;
    }
    this.els.statusAi.hidden = !tab.aiDetected;
    this.els.statusSize.textContent = tab.term ? `${tab.term.cols}×${tab.term.rows}` : "—";
    this.syncAiButton();
  }

  private updateClock(): void {
    if (this.els?.statusClock) this.els.statusClock.textContent = formatClock();
  }

  /* ------------------------------------------------------------------ */
  /* Chrome                                                             */
  /* ------------------------------------------------------------------ */

  private bindChrome(): void {
    this.bindTabsChrome();

    this.els.aiToggle.addEventListener("click", () => this.toggleReader());
    this.els.paletteButton.addEventListener("click", () => this.openPalette());
    this.els.searchButton.addEventListener("click", () => this.openSearch());
    this.els.snippetsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleSnippetsPopover();
    });
    this.els.settingsButton.addEventListener("click", () => this.openSettings());
    this.els.themeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleThemePopover();
    });
    this.els.sidebarToggle.addEventListener("click", () => this.toggleSidebar());
    this.els.sidebarCollapse.addEventListener("click", () => this.setSidebar(false));
    this.els.toolbarRestart.addEventListener("click", () => void this.manager.restart());
    this.els.toolbarClose.addEventListener("click", () => void this.manager.closeActive());
    this.els.sidebarAi.addEventListener("click", () => this.toggleReader());
    this.els.statusAi.addEventListener("click", () => this.openReader());

    this.els.pathChip.addEventListener("click", async () => {
      const cwd = this.manager.active?.cwd;
      if (!cwd) return;
      await window.eterm.clipboardWrite(cwd);
      toast("已复制当前路径", { tone: "success", detail: cwd, duration: 1600 });
    });

    this.els.sidebarPath.addEventListener("click", async () => {
      const cwd = this.manager.active?.cwd;
      if (!cwd) return;
      await window.eterm.clipboardWrite(cwd);
      toast("已复制工作目录", { tone: "success", duration: 1500 });
    });
    this.els.sidebarBranch.addEventListener("click", async () => {
      const branch = this.manager.active?.branch;
      if (!branch) return;
      await window.eterm.clipboardWrite(branch);
      toast(`已复制分支名 ${branch}`, { tone: "success", duration: 1500 });
    });
    this.bindSidebar();
    this.bindThemePopover();
    this.bindSnippets();

    this.els.terminalPanel.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".xterm-host") && !target.closest(".search-bar")) {
        this.hideContextMenu();
      }
    });

    for (const button of this.els.shell.querySelectorAll<HTMLButtonElement>("[data-win]")) {
      button.addEventListener("click", () => {
        const action = button.dataset.win as "minimize" | "close" | "toggle-maximize" | undefined;
        if (action) void window.eterm.windowControl(action);
      });
    }

    this.bindSearch();
  }

  private toggleReader(): void {
    if (this.reader.isOpen) this.reader.close();
    else this.reader.open();
  }

  private openReader(): void {
    if (!this.reader.isOpen) this.reader.open();
  }

  private openPalette(): void {
    this.hideProfileMenu();
    this.hideContextMenu();
    this.hideThemePopover();
    this.hideSnippetsPopover();
    if (this.settingsPanel?.isOpen) this.settingsPanel.close();
    this.palette.open();
  }

  private openSettings(): void {
    this.hideProfileMenu();
    this.hideContextMenu();
    this.hideThemePopover();
    this.hideSnippetsPopover();
    if (this.palette?.isOpen) this.palette.close();
    if (this.settingsPanel.isOpen) return;
    this.settingsPanel.setSettings(this.settings);
    this.settingsPanel.open();
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                             */
  /* ------------------------------------------------------------------ */

  private bindSearch(): void {
    this.els.searchInput.addEventListener("input", () => this.runSearch(true));
    this.els.searchInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeSearch(true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) this.findSearch(false);
        else this.findSearch(true);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        this.els.searchInput.select();
      }
    });
    this.els.searchNext.addEventListener("click", () => this.findSearch(true));
    this.els.searchPrev.addEventListener("click", () => this.findSearch(false));
    this.els.searchClose.addEventListener("click", () => this.closeSearch(true));
    this.els.searchCase.addEventListener("click", () => {
      this.searchCaseSensitive = !this.searchCaseSensitive;
      this.els.searchCase.classList.toggle("is-active", this.searchCaseSensitive);
      this.els.searchCase.setAttribute("aria-pressed", String(this.searchCaseSensitive));
      this.runSearch(true);
    });
  }

  private openSearch(): void {
    const tab = this.manager.active;
    if (!tab) return;
    this.hideProfileMenu();
    this.hideContextMenu();
    this.els.searchBar.hidden = false;
    this.els.searchBar.classList.add("is-open");
    const selection = tab.term.getSelection();
    if (selection && !selection.includes("\n")) this.els.searchInput.value = selection;
    this.searchDispose?.dispose();
    this.searchDispose = tab.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.renderSearchCount(resultIndex, resultCount);
    });
    this.els.searchInput.focus();
    this.els.searchInput.select();
    if (this.els.searchInput.value) this.runSearch(true);
  }

  private closeSearch(focusTerminal = false): void {
    if (!this.els || this.els.searchBar.hidden) return;
    this.els.searchBar.classList.remove("is-open");
    this.els.searchBar.hidden = true;
    const tab = this.manager.active;
    tab?.search.clearDecorations();
    this.els.searchCount.textContent = "";
    this.searchDispose?.dispose();
    this.searchDispose = null;
    if (focusTerminal) this.manager.focus();
  }

  private searchOptions(): {
    caseSensitive: boolean;
    incremental: boolean;
    decorations: {
      matchBackground: string;
      matchBorder: string;
      matchOverviewRuler: string;
      activeMatchBackground: string;
      activeMatchBorder: string;
      activeMatchColorOverviewRuler: string;
    };
  } {
    const dark = this.settings.theme !== "light";
    return {
      caseSensitive: this.searchCaseSensitive,
      incremental: true,
      decorations: dark
        ? {
            matchBackground: "#1c4a42",
            matchBorder: "#2f7a6c",
            matchOverviewRuler: "#4d9e8e",
            activeMatchBackground: "#327468",
            activeMatchBorder: "#86f0d5",
            activeMatchColorOverviewRuler: "#86f0d5",
          }
        : {
            matchBackground: "#f4e2a4",
            matchBorder: "#d5b768",
            matchOverviewRuler: "#c39a2c",
            activeMatchBackground: "#f0b55f",
            activeMatchBorder: "#8c5c12",
            activeMatchColorOverviewRuler: "#8c5c12",
          },
    };
  }

  private runSearch(incremental: boolean): void {
    const tab = this.manager.active;
    const term = this.els.searchInput.value;
    if (!tab) return;
    if (!term) {
      tab.search.clearDecorations();
      this.els.searchCount.textContent = "";
      return;
    }
    tab.search.findNext(term, { ...this.searchOptions(), incremental });
  }

  private findSearch(next: boolean): void {
    const tab = this.manager.active;
    const term = this.els.searchInput.value;
    if (!tab || !term) return;
    const options = this.searchOptions();
    if (next) tab.search.findNext(term, options);
    else tab.search.findPrevious(term, options);
  }

  private renderSearchCount(index: number, count: number): void {
    if (count <= 0) {
      this.els.searchCount.textContent = "0/0";
      this.els.searchCount.classList.add("is-empty");
      return;
    }
    this.els.searchCount.classList.remove("is-empty");
    this.els.searchCount.textContent = count < 0 ? "1000+" : `${index + 1}/${count}`;
  }

  private refreshSearchDecorations(): void {
    if (this.els?.searchBar.hidden === false && this.els.searchInput.value) this.runSearch(false);
  }

  /* ------------------------------------------------------------------ */
  /* Context menu                                                       */
  /* ------------------------------------------------------------------ */

  private bindTerminalContextMenu(): void {
    this.els.terminalPanel.addEventListener("contextmenu", (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".xterm-host")) return;
      event.preventDefault();
      this.showContextMenu(event.clientX, event.clientY);
    });
  }

  private showContextMenu(x: number, y: number): void {
    this.hideProfileMenu();
    this.hideContextMenu();
    this.hideSnippetsPopover();
    const tab = this.manager.active;
    const hasSelection = this.manager.hasSelection();
    const menu = this.els.contextMenu;
    const item = (action: string, label: string, glyph: IconName, shortcut = "", disabled = false, danger = false) =>
      `<button type="button" class="context-item${danger ? " is-danger" : ""}" data-context-action="${action}" ${disabled ? "disabled" : ""}>
        <span class="context-item__icon">${icon(glyph, 14)}</span><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ""}
      </button>`;
    menu.innerHTML = `
      ${item("copy", "复制", "copy", shortcuts.copy, !hasSelection)}
      ${item("paste", "粘贴", "download", shortcuts.paste)}
      ${item("select-all", "全选", "expand")}
      <div class="context-sep"></div>
      ${item("search", "搜索会话", "search", shortcuts.search)}
      ${item("clear", "清屏", "terminal")}
      <div class="context-sep"></div>
      ${item("new-tab", "新建标签", "plus", shortcuts.newTab)}
      ${item("ai", "AI 阅读器", "sparkles", shortcuts.ai)}
      ${item("ai-selection", "美化选中内容", "wand", "", !hasSelection)}
      <div class="context-sep"></div>
      ${item("restart", "重启当前会话", "rotate")}
      ${item("close-tab", "关闭标签", "x", shortcuts.closeTab, !tab, true)}`;
    menu.hidden = false;
    menu.classList.add("is-open");

    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, x));
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, y));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onPointer = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) this.hideContextMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.hideContextMenu();
    };
    const onScroll = () => this.hideContextMenu();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onScroll);
    window.addEventListener("resize", onScroll);
    this.contextCleanup = () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }

  private hideContextMenu = (): void => {
    if (this.els.contextMenu.hidden) return;
    this.els.contextMenu.classList.remove("is-open");
    this.els.contextMenu.hidden = true;
    this.contextCleanup?.();
    this.contextCleanup = null;
  };

  private handleContextAction(action: string): void {
    this.hideContextMenu();
    switch (action) {
      case "copy":
        void this.manager.copySelection().then((ok) => {
          if (ok) toast("已复制选中内容", { tone: "success", duration: 1400 });
        });
        break;
      case "paste":
        void this.manager.paste();
        break;
      case "select-all":
        this.manager.selectAll();
        break;
      case "search":
        this.openSearch();
        break;
      case "clear":
        this.manager.clearActive();
        break;
      case "new-tab":
        void this.manager.createTab({ profileId: this.settings.defaultProfile || undefined });
        break;
      case "ai":
        this.openReader();
        break;
      case "ai-selection":
        this.reader.useSelection();
        break;
      case "restart":
        void this.manager.restart();
        break;
      case "close-tab":
        void this.manager.closeActive();
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Commands                                                           */
  /* ------------------------------------------------------------------ */

  private buildPaletteActions(): PaletteAction[] {
    const actions: PaletteAction[] = [];
    for (const profile of this.boot.profiles) {
      actions.push({
        id: `new-${profile.id}`,
        title: `新建 ${profile.name}`,
        group: "会话",
        detail: profile.description,
        icon: "terminal",
        keywords: profile.short,
        run: () => void this.manager.createTab({ profileId: profile.id }),
      });
    }
    for (const snippet of this.commands) {
      actions.push({
        id: `snippet-${snippet.id}`,
        title: snippet.name,
        group: "常用命令",
        detail: snippet.command,
        icon: "bolt",
        keywords: "command snippet 快捷命令",
        run: () => this.runSnippet(snippet),
      });
    }
    actions.push({
      id: "manage-snippets",
      title: "管理常用命令",
      group: "常用命令",
      detail: "保存、编辑或删除快捷命令",
      icon: "bolt",
      run: () => this.openSnippetsPopover(),
    });

    actions.push(
      {
        id: "new-tab",
        title: "新建标签页",
        group: "会话",
        detail: this.settings.defaultProfile
          ? `使用 ${
              this.boot.profiles.find((profile) => profile.id === this.settings.defaultProfile)?.name ||
              this.settings.defaultProfile
            }`
          : "跟随当前标签的 Shell",
        shortcut: shortcuts.newTab,
        icon: "plus",
        run: () => void this.manager.createTab({ profileId: this.settings.defaultProfile || undefined }),
      },
      {
        id: "close-tab",
        title: "关闭当前标签",
        group: "会话",
        shortcut: shortcuts.closeTab,
        icon: "x",
        run: () => void this.manager.closeActive(),
      },
      {
        id: "restart",
        title: "重启当前会话",
        group: "会话",
        icon: "rotate",
        run: () => void this.manager.restart(),
      },
      {
        id: "clear",
        title: "清屏",
        group: "会话",
        detail: "发送 Ctrl+L",
        icon: "terminal",
        keywords: "clear cls",
        run: () => this.manager.clearActive(),
      },
      {
        id: "copy",
        title: "复制选中内容",
        group: "编辑",
        shortcut: shortcuts.copy,
        icon: "copy",
        run: () =>
          void this.manager.copySelection().then((ok) => {
            if (ok) toast("已复制选中内容", { tone: "success", duration: 1400 });
          }),
      },
      {
        id: "paste",
        title: "粘贴",
        group: "编辑",
        shortcut: shortcuts.paste,
        icon: "download",
        run: () => void this.manager.paste(),
      },
      {
        id: "search",
        title: "搜索当前会话",
        group: "编辑",
        shortcut: shortcuts.search,
        icon: "search",
        run: () => this.openSearch(),
      },
      {
        id: "ai-reader",
        title: this.reader.isOpen ? "关闭 AI 阅读器" : "打开 AI 阅读器",
        group: "AI",
        detail: "把终端里的 AI 回复重排成 Markdown",
        shortcut: shortcuts.ai,
        icon: "sparkles",
        run: () => this.toggleReader(),
      },
      {
        id: "ai-selection",
        title: "美化选中内容",
        group: "AI",
        icon: "wand",
        keywords: "selection",
        run: () => this.reader.useSelection(),
      },
      {
        id: "theme-panel",
        title: "打开主题面板",
        group: "外观",
        detail: `当前主题：${getTheme(this.settings.theme).name}`,
        icon: "palette",
        run: () => this.openThemePopover(),
      },
      {
        id: "sidebar",
        title: this.settings.sidebarOpen ? "收起工作区侧栏" : "展开工作区侧栏",
        group: "外观",
        icon: "panel-left",
        shortcut: `${mod}+${shift}+B`,
        run: () => this.toggleSidebar(),
      },
      {
        id: "wallpaper",
        title: this.settings.wallpaper === "aurora" ? "切换到柔光壁纸" : this.settings.wallpaper === "clean" ? "切换到标定壁纸" : "切换到极光壁纸",
        group: "外观",
        icon: "palette",
        run: () => {
          const next =
            this.settings.wallpaper === "aurora" ? "clean" : this.settings.wallpaper === "clean" ? "specimen" : "aurora";
          this.applySettings({ ...this.settings, wallpaper: next });
          toast(
            next === "aurora" ? "极光壁纸" : next === "clean" ? "柔光壁纸" : "标定壁纸",
            { tone: "info", duration: 1500 },
          );
        },
      },
      {
        id: "settings",
        title: "打开设置",
        group: "外观",
        shortcut: shortcuts.settings,
        icon: "sliders",
        run: () => this.openSettings(),
      },
      {
        id: "about",
        title: "关于 ETerminal",
        group: "帮助",
        detail: "真实 PTY · WebGL 光学玻璃 · AI 阅读器",
        icon: "info",
        run: () =>
          toast(`ETerminal v${this.boot.version}`, {
            tone: "info",
            detail: "Electron + WebGL2 + xterm.js · 本地运行，不上传终端内容",
            duration: 5200,
          }),
      },
    );
    return actions;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                 */
  /* ------------------------------------------------------------------ */

  private startTimers(): void {
    window.clearInterval(this.aiTimer);
    window.clearInterval(this.clockTimer);
    this.aiTimer = window.setInterval(() => this.pollAi(), 900);
    this.clockTimer = window.setInterval(() => this.updateClock(), 15_000);
    window.setTimeout(() => this.pollAi(), 600);
  }

  private pollAi(force = false): void {
    if (document.hidden) return;
    const tab = this.manager.active;
    if (!tab) return;

    // Idle consoles do not need a buffer parse every 900ms. A 2.5s grace
    // window keeps detection responsive while output is streaming.
    const recentlyActive = Date.now() - tab.lastActiveAt < 2500;
    if (!force && !recentlyActive) {
      if (this.reader?.isOpen) {
        if (!tab.aiResult?.working) return;
      } else {
        return;
      }
    }

    if (this.reader?.isOpen) {
      this.reader.refresh();
      return;
    }

    if (!this.settings.aiAuto) return;
    if (tab.status === "exited") return;
    const raw = this.manager
      .getActiveLines(220)
      .lines.map((line) => line.text)
      .join("\n");
    const detected = isAiTranscript(raw);
    if (detected !== tab.aiDetected) {
      tab.aiDetected = detected;
      if (detected) {
        if (!this.aiNotified.has(tab.id) && !this.suppressAiToast) {
          this.aiNotified.add(tab.id);
          toast("检测到 AI 输出", {
            tone: "ai",
            detail: `${shortcuts.ai} 打开 AI 阅读器，把回复重排成文档`,
            duration: 4400,
          });
        }
      } else {
        this.aiNotified.delete(tab.id);
      }
      this.syncAiButton();
      this.updateTabIndicators();
      this.updateStatus();
      this.renderSidebar();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  private bindShortcuts(): void {
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.isComposing) return;
        const modKey = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        const isPaletteChord = modKey && event.shiftKey && key === "p";
        const isSettingsChord = modKey && key === ",";

        if (isPaletteChord) {
          event.preventDefault();
          event.stopPropagation();
          if (this.palette.isOpen) this.palette.close();
          else this.openPalette();
          return;
        }
        if (isSettingsChord) {
          event.preventDefault();
          event.stopPropagation();
          if (this.settingsPanel.isOpen) this.settingsPanel.close();
          else this.openSettings();
          return;
        }
        if (this.palette.isOpen || this.settingsPanel.isOpen) return;

        const target = event.target instanceof HTMLElement ? event.target : document.body;
        const inTerminal = Boolean(target.closest(".xterm"));
        const inEditable =
          !inTerminal &&
          Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

        if (event.key === "Escape") {
          if (!this.els.searchBar.hidden) {
            event.preventDefault();
            this.closeSearch(true);
            return;
          }
          if (!this.els.contextMenu.hidden) {
            this.hideContextMenu();
            return;
          }
          if (!this.els.profileMenu.hidden) {
            this.hideProfileMenu();
            return;
          }
          if (!this.els.themePopover.hidden) {
            this.hideThemePopover();
            return;
          }
        }
        if (this.els.searchBar.hidden === false && target === this.els.searchInput) return;
        if (inEditable) return;

        if (modKey && event.shiftKey && key === "t") {
          event.preventDefault();
          void this.manager.createTab({ profileId: this.settings.defaultProfile || undefined });
          return;
        }
        if (modKey && event.shiftKey && key === "w") {
          event.preventDefault();
          void this.manager.closeActive();
          return;
        }
        if (modKey && event.shiftKey && key === "f") {
          event.preventDefault();
          this.openSearch();
          return;
        }
        if (modKey && event.shiftKey && key === "a") {
          event.preventDefault();
          this.toggleReader();
          return;
        }
        if (modKey && event.shiftKey && key === "b") {
          event.preventDefault();
          this.toggleSidebar();
          return;
        }
        if (modKey && event.key === "Tab") {
          event.preventDefault();
          this.manager.cycle(event.shiftKey ? -1 : 1);
          return;
        }
        if (modKey && !event.shiftKey && !event.altKey && /^[1-9]$/u.test(event.key)) {
          event.preventDefault();
          this.manager.activateIndex(Number(event.key) - 1);
          return;
        }
        if (modKey && event.shiftKey && key === "c") {
          event.preventDefault();
          void this.manager.copySelection().then((ok) => {
            if (ok) toast("已复制选中内容", { tone: "success", duration: 1400 });
          });
          return;
        }
        if (modKey && event.shiftKey && key === "v") {
          event.preventDefault();
          void this.manager.paste();
          return;
        }
        if (modKey && (event.key === "+" || event.key === "=")) {
          event.preventDefault();
          this.zoomFont(1);
          return;
        }
        if (modKey && event.key === "-") {
          event.preventDefault();
          this.zoomFont(-1);
          return;
        }
        if (modKey && event.key === "0") {
          event.preventDefault();
          this.zoomFont(0);
          return;
        }
        if (event.key === "F11") {
          event.preventDefault();
          void window.eterm.windowControl("toggle-fullscreen");
          return;
        }
        if (event.key === "F1") {
          event.preventDefault();
          this.openPalette();
        }
      },
      true,
    );

    this.els.contextMenu.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-context-action]");
      if (!button) return;
      this.handleContextAction(button.dataset.contextAction || "");
    });

    this.els.terminalPanel.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".xterm-host")) this.manager.focus();
    });
  }

  private zoomFont(direction: 1 | -1 | 0): void {
    const next = direction === 0 ? 14 : Math.max(11, Math.min(24, this.settings.fontSize + direction));
    if (next === this.settings.fontSize) return;
    this.applySettings({ ...this.settings, fontSize: next });
    toast(`终端字号 ${next}px`, { tone: "info", duration: 1200 });
  }

  /* ------------------------------------------------------------------ */
  /* Workbench sidebar                                                  */
  /* ------------------------------------------------------------------ */

  private bindSidebar(): void {
    this.els.sidebarNewSession.addEventListener("click", (event) => {
      event.stopPropagation();
      this.hideThemePopover();
      if (this.els.profileMenu.hidden) this.showProfileMenu(this.els.sidebarNewSession);
      else this.hideProfileMenu();
    });
    this.els.sidebarSessions.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-sidebar-tab-id]");
      if (!row) return;
      const id = row.dataset.sidebarTabId;
      if (!id) return;
      if (target.closest("[data-sidebar-close]")) {
        event.stopPropagation();
        void this.manager.closeTab(id);
        return;
      }
      this.manager.activate(id);
    });
  }

  private toggleSidebar(): void {
    this.setSidebar(!this.settings.sidebarOpen);
  }

  private setSidebar(open: boolean): void {
    if (!this.els) return;
    this.settings.sidebarOpen = open;
    saveSettings(this.settings);
    this.els.sessionsSidebar.hidden = !open;
    this.els.sidebarToggle.classList.toggle("is-active", open);
    this.els.sidebarToggle.setAttribute("aria-pressed", String(open));
    this.els.workspace.classList.toggle("has-sidebar", open);
    this.settingsPanel?.setSettings(this.settings);
    this.glass?.refresh();
    requestAnimationFrame(() => this.manager.fitActive());
    window.setTimeout(() => this.manager.fitActive(), 180);
  }

  private updateSidebarAiState(): void {
    if (!this.els?.sidebarAi) return;
    const tab = this.manager?.active;
    const open = this.reader?.isOpen ?? false;
    const detected = Boolean(tab?.aiDetected);
    this.els.sidebarAi.classList.toggle("is-active", open);
    this.els.sidebarAi.classList.toggle("has-ai", detected);
    this.els.sidebarAiStatus.textContent = open
      ? "阅读中 · 实时跟随"
      : detected
        ? "AI 输出已就绪"
        : "打开阅读器";
  }

  private renderSidebar(): void {
    if (!this.els || !this.manager) return;
    const active = this.manager.active;
    const tabs = this.manager.tabs;

    this.els.sidebarSessionCount.textContent = String(tabs.length);

    this.els.sidebarSessions.innerHTML = tabs
      .map((tab) => {
        const isActive = tab === active;
        return `<div class="sidebar-session${isActive ? " is-active" : ""}" data-sidebar-tab-id="${tab.id}">
          <button type="button" class="sidebar-session__main" title="${escapeHtml(tab.title)}">
            <span class="sidebar-session__badge" data-kind="${tab.profile.kind}">${escapeHtml(tab.profile.short)}</span>
            <span class="sidebar-session__body">
              <span class="sidebar-session__title">${escapeHtml(tab.title)}</span>
              <span class="sidebar-session__meta">${escapeHtml(tab.profile.short)} · ${escapeHtml(tab.cwd && !isHomePath(tab.cwd, this.boot.home) ? basename(tab.cwd) : "~")}</span>
            </span>
            ${tab.aiDetected ? `<span class="sidebar-session__ai" title="检测到 AI 输出">${icon("sparkles", 11)}</span>` : ""}
            <span class="sidebar-session__status" data-status="${tab.status}"></span>
          </button>
          <button type="button" class="sidebar-session__close" data-sidebar-close title="关闭会话" aria-label="关闭会话">${icon("x", 12)}</button>
        </div>`;
      })
      .join("");

    const pathText = this.els.sidebarPath.querySelector("span");
    if (pathText) pathText.textContent = active ? prettyCwd(active.cwd, this.boot.home) : "~";
    this.els.sidebarPath.title = active?.cwd ? `${active.cwd}\n点击复制` : "当前目录";
    const branchText = this.els.sidebarBranch.querySelector("span");
    this.els.sidebarBranch.hidden = !active?.branch;
    if (branchText) branchText.textContent = active?.branch || "";
    this.els.sidebarBranch.title = active?.branch ? `当前分支：${active.branch}\n点击复制` : "分支";
    this.updateSidebarAiState();
  }

  /* ------------------------------------------------------------------ */
  /* Theme popover                                                      */
  /* ------------------------------------------------------------------ */

  private bindThemePopover(): void {
    this.els.themePopover.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>("[data-theme-option]");
      if (card?.dataset.themeOption) {
        const theme = card.dataset.themeOption as Settings["theme"];
        this.applySettings({ ...this.settings, theme });
        this.syncThemePopover(theme);
        return;
      }
      if (target.closest("[data-theme-settings]")) {
        this.hideThemePopover();
        this.openSettings();
      }
    });
  }

  private openThemePopover(): void {
    if (this.themePopoverOpen) {
      this.hideThemePopover();
      return;
    }
    this.hideProfileMenu();
    this.hideContextMenu();
    this.hideSnippetsPopover();
    if (this.settingsPanel?.isOpen) this.settingsPanel.close();
    if (this.palette?.isOpen) this.palette.close();
    const popover = this.els.themePopover;
    popover.innerHTML = `
      <div class="theme-popover__head">
        <div><span class="theme-popover__eyebrow">APPEARANCE</span><strong>主题</strong></div>
        <span class="theme-popover__count">${THEMES.length} 套</span>
      </div>
      <div class="theme-grid theme-grid--popover" role="group" aria-label="主题">${themeCardsMarkup(this.settings.theme)}</div>
      <div class="theme-popover__foot">
        <span data-theme-current>${getTheme(this.settings.theme).name} · 即时生效</span>
        <button type="button" class="soft-button" data-theme-settings>${icon("sliders", 13)}<span>材质设置</span></button>
      </div>`;
    popover.hidden = false;
    popover.classList.add("is-open");
    this.themePopoverOpen = true;
    this.els.themeButton.classList.add("is-active");
    const rect = this.els.themeButton.getBoundingClientRect();
    const width = 332;
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`;
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popover.contains(target) || this.els.themeButton.contains(target)) return;
      this.hideThemePopover();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.hideThemePopover();
    };
    const onResize = () => this.hideThemePopover();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    this.themePopoverCleanup = () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }

  private hideThemePopover = (): void => {
    if (!this.themePopoverOpen) return;
    this.themePopoverOpen = false;
    this.els.themePopover.classList.remove("is-open");
    this.els.themePopover.hidden = true;
    this.els.themeButton.classList.remove("is-active");
    this.themePopoverCleanup?.();
    this.themePopoverCleanup = null;
  };

  private toggleThemePopover(): void {
    if (this.themePopoverOpen) this.hideThemePopover();
    else this.openThemePopover();
  }

  private syncThemePopover(theme: Settings["theme"]): void {
    if (!this.themePopoverOpen) return;
    for (const card of this.els.themePopover.querySelectorAll<HTMLElement>("[data-theme-option]")) {
      const active = card.dataset.themeOption === theme;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    }
    const current = this.els.themePopover.querySelector("[data-theme-current]");
    if (current) current.textContent = `${getTheme(theme).name} · 即时生效`;
  }

  /* ------------------------------------------------------------------ */
  /* Saved commands                                                     */
  /* ------------------------------------------------------------------ */

  private bindSnippets(): void {
    this.els.snippetsPopover.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>("[data-snippet-action]");
      if (action) {
        const id = action.dataset.snippetId;
        const kind = action.dataset.snippetAction;
        const snippet = this.commands.find((item) => item.id === id);
        if (!snippet) return;
        if (kind === "insert") {
          this.insertSnippet(snippet);
        } else if (kind === "edit") {
          this.snippetsFormOpen = true;
          this.snippetsEditingId = snippet.id;
          this.renderSnippets("name");
        } else if (kind === "delete") {
          this.commands = this.commands.filter((item) => item.id !== snippet.id);
          persistCommandSnippets(this.commands);
          if (this.snippetsEditingId === snippet.id) {
            this.snippetsFormOpen = false;
            this.snippetsEditingId = null;
          }
          this.renderSnippets();
          toast("已删除常用命令", { tone: "info", duration: 1400 });
        }
        return;
      }

      const run = target.closest<HTMLElement>("[data-snippet-run]");
      if (run?.dataset.snippetId) {
        const snippet = this.commands.find((item) => item.id === run.dataset.snippetId);
        if (snippet) this.runSnippet(snippet);
        return;
      }

      if (target.closest("[data-snippets-add]")) {
        this.snippetsFormOpen = true;
        this.snippetsEditingId = null;
        this.renderSnippets("command");
        return;
      }
      if (target.closest("[data-snippets-cancel]")) {
        this.snippetsFormOpen = false;
        this.snippetsEditingId = null;
        this.renderSnippets();
        return;
      }
    });

    this.els.snippetsPopover.addEventListener("submit", (event) => {
      const form = event.target as HTMLFormElement;
      if (!form.matches("[data-snippets-form]")) return;
      event.preventDefault();
      const data = new FormData(form);
      const command = String(data.get("command") || "").trim();
      if (!command) {
        const input = form.querySelector<HTMLInputElement>('[name="command"]');
        input?.focus();
        return;
      }
      const rawName = String(data.get("name") || "").trim();
      const name = rawName || formatCommandName(command);
      if (this.snippetsEditingId) {
        const snippet = this.commands.find((item) => item.id === this.snippetsEditingId);
        if (snippet) {
          snippet.name = name.slice(0, 80);
          snippet.command = command.slice(0, 4000);
          snippet.dangerous = isDangerousCommand(command);
        }
      } else {
        const snippet = createCommandSnippet(name, command);
        if (snippet) this.commands.push(snippet);
      }
      persistCommandSnippets(this.commands);
      this.snippetsFormOpen = false;
      this.snippetsEditingId = null;
      this.renderSnippets();
      toast("已保存常用命令", { tone: "success", duration: 1500 });
    });
  }

  private toggleSnippetsPopover(): void {
    if (this.snippetsOpen) this.hideSnippetsPopover();
    else this.openSnippetsPopover();
  }

  private openSnippetsPopover(): void {
    if (this.snippetsOpen) {
      this.hideSnippetsPopover();
      return;
    }
    this.hideProfileMenu();
    this.hideContextMenu();
    this.hideThemePopover();
    if (this.settingsPanel?.isOpen) this.settingsPanel.close();
    if (this.palette?.isOpen) this.palette.close();

    this.snippetsOpen = true;
    this.snippetsFormOpen = false;
    this.snippetsEditingId = null;
    this.renderSnippets();

    const popover = this.els.snippetsPopover;
    popover.hidden = false;
    popover.classList.add("is-open");
    this.els.snippetsButton.classList.add("is-active");
    this.els.snippetsButton.setAttribute("aria-expanded", "true");

    const rect = this.els.snippetsButton.getBoundingClientRect();
    const width = 410;
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`;
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popover.contains(target) || this.els.snippetsButton.contains(target)) return;
      this.hideSnippetsPopover();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (this.snippetsFormOpen) {
        this.snippetsFormOpen = false;
        this.snippetsEditingId = null;
        this.renderSnippets();
      } else {
        this.hideSnippetsPopover();
      }
    };
    const onResize = () => this.hideSnippetsPopover();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    this.snippetsCleanup = () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
    requestAnimationFrame(() => {
      popover.querySelector<HTMLButtonElement>("[data-snippet-run]")?.focus({ preventScroll: true });
    });
  }

  private hideSnippetsPopover = (): void => {
    if (!this.snippetsOpen) return;
    this.snippetsOpen = false;
    this.snippetsFormOpen = false;
    this.snippetsEditingId = null;
    this.els.snippetsPopover.classList.remove("is-open");
    this.els.snippetsPopover.hidden = true;
    this.els.snippetsButton.classList.remove("is-active");
    this.els.snippetsButton.setAttribute("aria-expanded", "false");
    this.snippetsCleanup?.();
    this.snippetsCleanup = null;
  };

  private renderSnippets(focus?: "name" | "command"): void {
    const popover = this.els.snippetsPopover;
    const editing = this.snippetsEditingId
      ? this.commands.find((item) => item.id === this.snippetsEditingId)
      : undefined;
    const rows = this.commands.length
      ? this.commands
          .map(
            (snippet) => `<div class="snippet-row">
              <button type="button" class="snippet-run" data-snippet-run data-snippet-id="${snippet.id}" title="运行：${escapeHtml(snippet.command)}">
                <span class="snippet-run__icon">${icon("play", 11)}</span>
                <span class="snippet-run__body">
                  <span class="snippet-run__name">${escapeHtml(snippet.name)}${
                    snippet.dangerous ? '<em class="snippet-danger">危险</em>' : ""
                  }</span>
                  <span class="snippet-run__command">${escapeHtml(snippet.command)}</span>
                </span>
              </button>
              <span class="snippet-actions">
                <button type="button" class="snippet-action" data-snippet-action="insert" data-snippet-id="${snippet.id}" title="只填入终端，不执行">${icon("corner", 13)}</button>
                <button type="button" class="snippet-action" data-snippet-action="edit" data-snippet-id="${snippet.id}" title="编辑">${icon("pencil", 13)}</button>
                <button type="button" class="snippet-action snippet-action--danger" data-snippet-action="delete" data-snippet-id="${snippet.id}" title="删除">${icon("trash", 13)}</button>
              </span>
            </div>`,
          )
          .join("")
      : `<div class="snippets-empty">${icon("bolt", 18)}<strong>还没有常用命令</strong><span>把常用的 Claude Code、构建或部署命令保存到这里。</span></div>`;

    const form = this.snippetsFormOpen
      ? `<form class="snippet-form" data-snippets-form>
          <label class="snippet-field"><span>名称（可选）</span><input name="name" type="text" maxlength="80" placeholder="例如：Claude 跳过权限" value="${escapeHtml(editing?.name || "")}" /></label>
          <label class="snippet-field"><span>命令</span><input name="command" type="text" maxlength="4000" required spellcheck="false" placeholder="claude --dangerously-skip-permissions" value="${escapeHtml(editing?.command || "")}" /></label>
          <div class="snippet-form__foot">
            <span>命令会以键盘输入方式写入当前终端</span>
            <button type="button" class="soft-button" data-snippets-cancel>取消</button>
            <button type="submit" class="soft-button soft-button--accent">${editing ? "更新" : "保存"}</button>
          </div>
        </form>`
      : "";

    popover.innerHTML = `
      <div class="snippets-head">
        <div><span class="snippets-eyebrow">COMMANDS</span><strong>常用命令</strong></div>
        <span class="snippets-count">${this.commands.length}</span>
      </div>
      <div class="snippets-list">${rows}</div>
      ${
        this.snippetsFormOpen
          ? ""
          : `<div class="snippets-foot"><button type="button" class="snippets-add" data-snippets-add>${icon("plus", 13)}<span>新建命令</span></button><span>点击运行 · 也可只填入</span></div>`
      }
      ${form}`;

    if (focus) {
      requestAnimationFrame(() => {
        const selector = focus === "name" ? '[name="name"]' : '[name="command"]';
        popover.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true });
      });
    }
  }

  private insertSnippet(snippet: CommandSnippet): void {
    if (!this.manager.active) {
      toast("当前没有可用的终端会话", { tone: "warning" });
      return;
    }
    this.hideSnippetsPopover();
    this.manager.writeToActive(snippet.command);
    this.manager.focus();
    toast("已填入命令，按 Enter 执行", { tone: "info", detail: snippet.command, duration: 2400 });
  }

  private runSnippet(snippet: CommandSnippet): void {
    if (!this.manager.active) {
      toast("当前没有可用的终端会话", { tone: "warning" });
      return;
    }
    this.hideSnippetsPopover();
    this.manager.runInActive(snippet.command);
  }

  /* ------------------------------------------------------------------ */
  /* Window                                                             */
  /* ------------------------------------------------------------------ */

  private bindWindowState(): void {
    const apply = (state: WindowState) => {
      this.els.shell.classList.toggle("is-maximized", state.maximized || state.fullscreen);
      this.els.winMax.innerHTML = state.maximized ? icon("restore", 13) : icon("square", 13);
      this.els.winMax.title = state.maximized ? "还原" : "最大化";
      this.els.winMax.setAttribute("aria-label", state.maximized ? "还原" : "最大化");
    };
    void window.eterm.windowState().then(apply).catch(() => {});
    window.eterm.onWindowState(apply);
  }

  /* ------------------------------------------------------------------ */
  /* Demo                                                               */
  /* ------------------------------------------------------------------ */

  private async runDemo(mode: string): Promise<void> {
    await delay(1200);
    const tab = this.manager.active;
    if (!tab) return;
    const readerMode =
      mode !== "settings" &&
      mode !== "palette" &&
      mode !== "search" &&
      mode !== "theme" &&
      mode !== "commands";

    // Keep documented screenshots deterministic regardless of saved settings.
    const forcedTheme = mode.startsWith("skin-")
      ? coerceTheme(mode.slice("skin-".length))
      : mode === "ai-light"
        ? "light"
        : "aurora";
    this.applySettings({ ...this.settings, theme: forcedTheme, sidebarOpen: false });
    // Let the fit/resize (and PowerShell's prompt redraw) settle before we
    // paint the showcase transcript.
    await delay(700);

    if (readerMode) {
      // Open first so the terminal resize (and PSReadLine redraw) settles before
      // the showcase transcript is painted into the buffer.
      this.reader.open();
      // Give PowerShell / PSReadLine time to finish its resize redraw first.
      await delay(1800);
      this.manager.writeDisplay(demoTranscript(this.boot.appCwd));
      await delay(700);
      this.reader.refresh(true);
    } else if (
      mode === "settings" ||
      mode === "palette" ||
      mode === "theme" ||
      mode === "commands"
    ) {
      // Open the overlay first. PowerShell can repaint its prompt after a
      // resize; painting the showcase transcript last keeps it visible behind
      // the overlay for documentation screenshots.
      if (mode === "settings") this.openSettings();
      else if (mode === "palette") this.openPalette();
      else if (mode === "theme") this.openThemePopover();
      else this.openSnippetsPopover();
      await delay(650);
      this.manager.writeDisplay(demoTranscript(this.boot.appCwd));
      await delay(900);
    } else {
      this.manager.writeDisplay(demoTranscript(this.boot.appCwd));
      await delay(700);
      this.openSearch();
      this.els.searchInput.value = "玻璃";
      this.runSearch(true);
    }
    this.suppressAiToast = false;
  }
}

async function boot(): Promise<void> {
  const appUi = document.getElementById("app-ui");
  if (!appUi) throw new Error("App root missing");
  document.body.classList.add("is-booting");
  const settings = loadSettings();
  document.documentElement.dataset.theme = settings.theme;

  const info = await window.eterm.bootstrap();
  const app = new ETerminalApp(info, settings, appUi);
  await app.start();
  if (info.isDev || info.debug) {
    (window as unknown as Record<string, unknown>).__ET = app;
  }
}

boot().catch((error: unknown) => {
  console.error(error);
  const appUi = document.getElementById("app-ui");
  if (appUi) {
    appUi.innerHTML = `<div class="fatal-error">
      <span class="fatal-error__mark">${appMark(34)}</span>
      <h1>ETerminal 启动失败</h1>
      <p>无法初始化终端会话。请检查日志或重新启动应用。</p>
      <pre>${escapeHtml(error instanceof Error ? error.stack || error.message : String(error))}</pre>
      <button type="button" class="soft-button soft-button--accent" data-action="reload">重新加载</button>
    </div>`;
    appUi.querySelector('[data-action="reload"]')?.addEventListener("click", () => location.reload());
  }
  document.body.classList.remove("is-booting");
});

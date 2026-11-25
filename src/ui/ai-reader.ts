import { parseTerminalOutput, type ParseResult, type ChatTurn } from "../ai/parser";
import { mountMarkdown } from "../ai/markdown";
import type { TerminalManager, TerminalTab } from "../terminal/manager";
import type { Settings } from "../settings";
import { icon } from "./icons";
import { escapeHtml } from "./dom";
import type { ToastTone } from "./toast";

interface ReaderOptions {
  panel: HTMLElement;
  manager: TerminalManager;
  settings: Settings;
  claudeAvailable: boolean;
  onResize(): void;
  onFollowChange(follow: boolean): void;
  onWidthChange(width: number): void;
  onNotify(message: string, tone?: ToastTone): void;
  onRunClaude(): void;
  onParsed(result: ParseResult, tab: TerminalTab): void;
  onVisibilityChange(open: boolean): void;
}

interface RenderMeta {
  title: string;
  profile: string;
  selected: boolean;
  forced: boolean;
}

const DEFAULT_WIDTH = 438;
const MIN_WIDTH = 344;
const MAX_WIDTH = 760;

export class AiReader {
  readonly panel: HTMLElement;
  private readonly manager: TerminalManager;
  private settings: Settings;
  private readonly options: ReaderOptions;
  private readonly body: HTMLElement;
  private readonly metaMode: HTMLElement;
  private readonly metaSource: HTMLElement;
  private readonly metaTime: HTMLElement;
  private readonly followButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly liveDot: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly jumpButton: HTMLButtonElement;

  private openState = false;
  private follow: boolean;
  private forceMode = false;
  private pinnedSelection: string | null = null;
  private lastSignature = "";
  private lastResult: ParseResult | null = null;
  private hasRendered = false;
  private programmaticScroll = false;
  private resizing = false;

  constructor(options: ReaderOptions) {
    this.panel = options.panel;
    this.manager = options.manager;
    this.settings = options.settings;
    this.options = options;
    this.follow = options.settings.aiFollow;

    this.panel.classList.add("ai-panel");
    this.panel.innerHTML = `
      <div class="ai-panel__scrim" aria-hidden="true"></div>
      <div class="ai-resizer" role="separator" aria-orientation="vertical" aria-label="调整 AI 阅读器宽度" tabindex="-1"></div>
      <header class="ai-panel__head">
        <div class="ai-identity">
          <span class="ai-orb" aria-hidden="true">${icon("sparkles", 16)}</span>
          <div class="ai-identity__copy">
            <span class="ai-eyebrow">AI READER <span class="ai-live-dot" data-live="idle"></span></span>
            <h2>输出美化</h2>
          </div>
        </div>
        <div class="ai-tools">
          <button type="button" class="ai-icon-button" data-role="follow" aria-pressed="true" title="跟随最新输出">${icon("arrow-down", 15)}</button>
          <button type="button" class="ai-icon-button" data-role="copy" title="复制回答 (Markdown)">${icon("copy", 15)}</button>
          <button type="button" class="ai-icon-button" data-role="refresh" title="重新读取终端">${icon("refresh", 15)}</button>
          <button type="button" class="ai-icon-button" data-role="close" title="关闭 (Ctrl+Shift+A)">${icon("x", 15)}</button>
        </div>
      </header>
      <div class="ai-panel__meta">
        <button type="button" class="ai-mode-chip" data-role="mode" title="切换阅读模式"></button>
        <span class="ai-source" data-role="source"></span>
        <span class="ai-updated" data-role="updated"></span>
      </div>
      <div class="ai-panel__body" data-role="body" tabindex="0"></div>
      <footer class="ai-panel__foot">
        <span class="ai-foot__hint">${icon("bolt", 12)}<span>实时读取终端缓冲区 · 不干扰会话</span></span>
        <span class="ai-foot__stats" data-role="stats"></span>
      </footer>
      <button type="button" class="ai-jump" data-role="jump" hidden>${icon("arrow-down", 14)} 新内容</button>
    `;

    this.body = this.query('[data-role="body"]');
    this.metaMode = this.query('[data-role="mode"]');
    this.metaSource = this.query('[data-role="source"]');
    this.metaTime = this.query('[data-role="updated"]');
    this.stats = this.query('[data-role="stats"]');
    this.followButton = this.query<HTMLButtonElement>('[data-role="follow"]');
    this.copyButton = this.query<HTMLButtonElement>('[data-role="copy"]');
    this.refreshButton = this.query<HTMLButtonElement>('[data-role="refresh"]');
    this.closeButton = this.query<HTMLButtonElement>('[data-role="close"]');
    this.jumpButton = this.query<HTMLButtonElement>('[data-role="jump"]');
    this.liveDot = this.query(".ai-live-dot");

    this.bind();
    this.applySettings(options.settings);
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        this.close();
      }
    });
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const node = this.panel.querySelector<T>(selector);
    if (!node) throw new Error(`AI reader element missing: ${selector}`);
    return node;
  }

  private bind(): void {
    this.closeButton.addEventListener("click", () => this.close());
    this.refreshButton.addEventListener("click", () => {
      this.refresh(true);
    });
    this.followButton.addEventListener("click", () => {
      this.setFollow(!this.follow);
      if (this.follow) this.scrollToBottom();
    });
    this.copyButton.addEventListener("click", () => void this.copy());
    this.metaMode.addEventListener("click", () => {
      if (this.pinnedSelection) {
        this.pinnedSelection = null;
        this.forceMode = false;
        this.refresh(true);
      } else {
        this.forceMode = !this.forceMode;
        this.refresh(true);
      }
    });
    this.jumpButton.addEventListener("click", () => {
      this.setFollow(true);
      this.scrollToBottom();
    });

    this.body.addEventListener("scroll", () => {
      if (this.programmaticScroll) return;
      const nearBottom = this.isNearBottom();
      if (!nearBottom && this.follow) {
        this.setFollow(false);
      }
      if (nearBottom) this.jumpButton.hidden = true;
    });

    this.body.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "run-claude") {
        this.options.onRunClaude();
      } else if (action === "force") {
        this.forceMode = true;
        this.pinnedSelection = null;
        this.refresh(true);
      } else if (action === "selection") {
        this.useSelection();
      } else if (action === "follow") {
        this.pinnedSelection = null;
        this.forceMode = false;
        this.refresh(true);
        this.options.onNotify("已切换为实时跟随", "success");
      }
    });

    const resizer = this.query<HTMLElement>(".ai-resizer");
    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.resizing = true;
      resizer.setPointerCapture(event.pointerId);
      this.panel.classList.add("is-resizing");
      document.body.classList.add("is-resizing-ai");
    });
    resizer.addEventListener("pointermove", (event) => {
      if (!this.resizing) return;
      const width = Math.max(
        MIN_WIDTH,
        Math.min(MAX_WIDTH, Math.min(window.innerWidth - 540, window.innerWidth - event.clientX - 24)),
      );
      this.applyWidth(width, false);
      this.options.onResize();
    });
    const endResize = () => {
      if (!this.resizing) return;
      this.resizing = false;
      this.panel.classList.remove("is-resizing");
      document.body.classList.remove("is-resizing-ai");
      this.options.onWidthChange(this.currentWidth());
      this.options.onResize();
    };
    resizer.addEventListener("pointerup", endResize);
    resizer.addEventListener("pointercancel", endResize);
    resizer.addEventListener("dblclick", () => {
      this.applyWidth(DEFAULT_WIDTH, true);
      this.options.onWidthChange(DEFAULT_WIDTH);
      this.options.onResize();
    });
  }

  private currentWidth(): number {
    return Math.round(this.panel.getBoundingClientRect().width) || this.settings.aiPanelWidth;
  }

  private applyWidth(width: number, persist: boolean): void {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
    document.documentElement.style.setProperty("--ai-width", `${clamped}px`);
    if (persist) this.settings.aiPanelWidth = clamped;
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.applyWidth(settings.aiPanelWidth, false);
    this.panel.style.setProperty("--ai-font-size", `${settings.aiFontSize}px`);
    if (settings.aiFollow !== this.follow && !this.openState) this.follow = settings.aiFollow;
    this.updateFollowButton();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(options: { force?: boolean } = {}): void {
    if (this.openState) {
      this.panel.focus?.();
      this.refresh(true);
      return;
    }
    this.openState = true;
    this.hasRendered = false;
    this.panel.hidden = false;
    this.panel.classList.add("is-open");
    this.forceMode = Boolean(options.force);
    this.pinnedSelection = null;
    this.setFollow(this.settings.aiFollow);
    this.refresh(true);
    this.options.onResize();
    this.options.onVisibilityChange(true);
    requestAnimationFrame(() => {
      this.body.scrollTop = this.body.scrollHeight;
    });
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.panel.classList.remove("is-open");
    this.panel.hidden = true;
    this.pinnedSelection = null;
    this.options.onResize();
    this.options.onVisibilityChange(false);
    this.manager.focus();
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  useSelection(): void {
    const selection = this.manager.getActiveSelection();
    if (!selection.trim()) {
      this.options.onNotify("终端里还没有选中文本", "info");
      return;
    }
    if (!this.openState) this.open();
    this.pinnedSelection = selection;
    this.forceMode = true;
    this.refresh(true);
    this.options.onNotify("正在美化选中的内容", "ai");
  }

  /** Clear a pinned selection when the active terminal changes. */
  handleTabChange(): void {
    if (this.pinnedSelection !== null) {
      this.pinnedSelection = null;
      this.forceMode = false;
    }
    if (this.openState) this.refresh(true);
  }

  refresh(forceRender = false): ParseResult | null {
    if (!this.openState && !forceRender) return null;
    const tab = this.manager.active;
    if (!tab) return null;

    let lines;
    let selected = false;
    if (this.pinnedSelection !== null) {
      lines = this.pinnedSelection.split(/\r?\n/u).map((text) => ({ text }));
      selected = true;
    } else {
      lines = this.manager.getActiveLines(700, false).lines;
    }

    const result = parseTerminalOutput(lines, { force: this.forceMode || selected });
    this.lastResult = result;
    this.options.onParsed(result, tab);
    this.render(result, {
      title: tab.title,
      profile: tab.profile.name,
      selected,
      forced: this.forceMode,
    });
    return result;
  }

  private setFollow(follow: boolean): void {
    this.follow = follow;
    this.updateFollowButton();
    this.options.onFollowChange(follow);
    if (follow) this.jumpButton.hidden = true;
  }

  private updateFollowButton(): void {
    this.followButton.classList.toggle("is-active", this.follow);
    this.followButton.setAttribute("aria-pressed", String(this.follow));
    this.followButton.title = this.follow ? "跟随最新输出：开" : "跟随最新输出：关";
  }

  private isNearBottom(): boolean {
    return this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 64;
  }

  private scrollToBottom(): void {
    this.programmaticScroll = true;
    this.body.scrollTop = this.body.scrollHeight;
    window.setTimeout(() => {
      this.programmaticScroll = false;
    }, 60);
    this.jumpButton.hidden = true;
  }

  private async copy(): Promise<void> {
    let text = "";
    if (this.pinnedSelection) {
      text = this.pinnedSelection;
    } else if (this.lastResult?.latest) {
      text = this.lastResult.latest.markdown || this.lastResult.latest.text;
    } else if (this.lastResult) {
      const first = this.lastResult.turns.find((turn) => turn.role === "assistant");
      text = first?.markdown || first?.text || "";
    }
    if (!text.trim()) {
      this.options.onNotify("暂时没有可复制的内容", "info");
      return;
    }
    await window.eterm.clipboardWrite(text);
    this.options.onNotify("已复制为 Markdown", "success");
    this.copyButton.classList.add("is-copied");
    window.setTimeout(() => this.copyButton.classList.remove("is-copied"), 1200);
  }

  private signature(result: ParseResult, meta: RenderMeta): string {
    return JSON.stringify({
      turns: result.turns.map((turn) => [turn.role, turn.text.length, turn.markdown, turn.tools]),
      working: result.working,
      detected: result.detected,
      meta,
      copyState: this.lastResult?.latest?.text.length,
    });
  }

  private render(result: ParseResult, meta: RenderMeta): void {
    const signature = this.signature(result, meta);
    const changed = signature !== this.lastSignature;
    const keepScroll = this.body.scrollTop;
    const wasNearBottom = this.isNearBottom();

    this.metaMode.textContent = meta.selected
      ? "选中内容"
      : meta.forced
        ? "整个屏幕"
        : "实时输出";
    this.metaMode.classList.toggle("is-pinned", meta.selected || meta.forced);
    this.metaSource.textContent =
      meta.title && meta.title !== meta.profile ? `${meta.profile} · ${meta.title}` : meta.profile;
    this.metaTime.textContent = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    this.stats.textContent = `${result.sourceLines} 行 · ${result.toolCount} 次工具调用`;
    this.liveDot.dataset.live = result.working ? "working" : result.detected ? "live" : "idle";
    this.liveDot.title = result.working ? "AI 正在生成" : result.detected ? "已连接 AI 输出" : "等待 AI 输出";
    this.copyButton.disabled = !result.latest && !this.pinnedSelection;

    if (!changed && !this.hasRendered) {
      this.lastSignature = signature;
    } else if (changed) {
      this.lastSignature = signature;
      this.hasRendered = true;
      this.renderMessages(result, meta);
    }

    if (this.follow || !this.hasRendered) {
      this.scrollToBottom();
    } else if (changed && wasNearBottom) {
      this.scrollToBottom();
    } else if (changed) {
      this.body.scrollTop = keepScroll;
      this.jumpButton.hidden = false;
    }
  }

  private renderMessages(result: ParseResult, meta: RenderMeta): void {
    this.body.innerHTML = "";
    const turns = result.turns.slice(-6);

    if (turns.length === 0) {
      this.body.append(this.renderEmpty(result));
      return;
    }

    for (const turn of turns) {
      if (turn.role === "user") this.body.append(this.renderUserTurn(turn));
      else this.body.append(this.renderAssistantTurn(turn, result, meta));
    }

    if (result.working) {
      const working = document.createElement("div");
      working.className = "ai-working";
      working.innerHTML = `<span class="ai-working__dots"><i></i><i></i><i></i></span><span>正在生成回复</span>`;
      this.body.append(working);
    }

    const end = document.createElement("div");
    end.className = "ai-end";
    end.innerHTML = `${icon("check", 12)}<span>${result.working ? "内容会继续更新" : "已读取终端最新内容"}</span>`;
    this.body.append(end);
  }

  private renderEmpty(result: ParseResult): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ai-empty";
    const selection = this.manager.getActiveSelection();
    const hasSelection = Boolean(selection.trim());
    wrap.innerHTML = `
      <div class="ai-empty__orb" aria-hidden="true"><span>${icon("sparkles", 22)}</span><i></i><i></i></div>
      <span class="ai-empty__eyebrow">${result.working ? "正在等待 AI 完成" : "NO AI OUTPUT YET"}</span>
      <h3>${result.working ? "终端里正在生成内容" : "让 AI 输出变成可读文档"}</h3>
      <p>${
        result.working
          ? "阅读器已连接。工具调用与回复完成后会自动整理成 Markdown。"
          : "在终端中运行 Claude Code、Codex 或其他 AI CLI，这里会实时提取回复并重新排版：更好的标题层级、代码高亮、工具调用摘要。"
      }</p>
      <div class="ai-empty__actions">
        ${this.options.claudeAvailable ? `<button type="button" class="soft-button soft-button--accent" data-action="run-claude">${icon("sparkles", 14)}<span>启动 Claude Code</span></button>` : ""}
        <button type="button" class="soft-button" data-action="force">${icon("wand", 14)}<span>渲染整个屏幕</span></button>
        ${hasSelection ? `<button type="button" class="soft-button" data-action="selection">${icon("corner", 14)}<span>美化选中内容</span></button>` : ""}
      </div>
      <div class="ai-empty__tips">
        <div><span>01</span>自动识别 Claude Code 的对话、工具调用与代码块</div>
        <div><span>02</span>只读镜像，不影响终端输入与快捷键</div>
        <div><span>03</span>全部内容只在本机解析，不会上传终端文本</div>
      </div>
    `;
    return wrap;
  }

  private renderUserTurn(turn: ChatTurn): HTMLElement {
    const node = document.createElement("div");
    node.className = "ai-turn ai-turn--user";
    node.innerHTML = `<span class="ai-role">你</span>`;
    const bubble = document.createElement("div");
    bubble.className = "ai-user-bubble";
    bubble.textContent = turn.text;
    node.append(bubble);
    return node;
  }

  private renderAssistantTurn(turn: ChatTurn, result: ParseResult, meta: RenderMeta): HTMLElement {
    const node = document.createElement("article");
    node.className = "ai-turn ai-turn--assistant";
    if (turn === result.latest) node.classList.add("is-latest");

    const head = document.createElement("div");
    head.className = "ai-turn__head";
    head.innerHTML = `
      <span class="ai-avatar" aria-hidden="true">${icon("sparkles", 13)}</span>
      <span class="ai-role">AI 助手</span>
      ${turn === result.latest ? '<span class="ai-badge">最新</span>' : ""}
      ${meta.selected ? '<span class="ai-badge ai-badge--soft">选中</span>' : ""}
    `;

    if (turn.tools.length > 0) {
      const tools = document.createElement("div");
      tools.className = "ai-tools-used";
      const counts = new Map<string, number>();
      for (const tool of turn.tools) counts.set(tool, (counts.get(tool) || 0) + 1);
      const entries = [...counts.entries()].slice(0, 6);
      tools.innerHTML = entries
        .map(
          ([name, count]) =>
            `<span class="tool-chip">${icon("bolt", 11)}<span>${escapeHtml(name)}</span>${count > 1 ? `<em>×${count}</em>` : ""}</span>`,
        )
        .join("");
      head.append(tools);
    }

    node.append(head);

    if (turn.markdown.trim()) {
      const markdown = document.createElement("div");
      markdown.className = "ai-markdown";
      node.append(markdown);
      mountMarkdown(markdown, turn.markdown);
    } else if (turn.tools.length > 0) {
      const note = document.createElement("p");
      note.className = "ai-tool-note";
      note.textContent = "正在使用工具处理任务…";
      node.append(note);
    }
    return node;
  }

  dispose(): void {
    // The DOM is owned by the app shell; no timers are held here.
  }
}

import { icon, type IconName } from "./icons";
import { escapeHtml } from "./dom";

export interface PaletteAction {
  id: string;
  title: string;
  group: string;
  detail?: string;
  shortcut?: string;
  icon?: IconName;
  keywords?: string;
  run: () => void | Promise<void>;
}

export class CommandPalette {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private actions: PaletteAction[] = [];
  private filtered: PaletteAction[] = [];
  private selected = 0;
  private openState = false;
  private previousFocus: HTMLElement | null = null;
  private readonly actionProvider: () => PaletteAction[];
  private readonly onClose: () => void;

  constructor(options: { host: HTMLElement; actions: () => PaletteAction[]; onClose: () => void }) {
    this.actionProvider = options.actions;
    this.onClose = options.onClose;
    this.root = document.createElement("div");
    this.root.className = "palette-overlay";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="overlay-backdrop" data-role="backdrop"></div>
      <section class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="palette__search">
          ${icon("search", 17)}
          <input type="text" placeholder="搜索命令、会话或设置…" spellcheck="false" autocomplete="off" />
          <kbd>ESC</kbd>
        </div>
        <div class="palette__list" role="listbox" aria-label="可用命令"></div>
        <div class="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 运行</span>
          <span class="palette__foot-brand">${icon("terminal", 12)} Command</span>
        </div>
      </section>`;
    options.host.append(this.root);

    this.input = this.root.querySelector("input")!;
    this.list = this.root.querySelector(".palette__list")!;
    this.bind();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  private bind(): void {
    this.root.querySelector('[data-role="backdrop"]')?.addEventListener("click", () => this.close());
    this.input.addEventListener("input", () => {
      this.selected = 0;
      this.applyFilter(this.input.value);
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this.move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.move(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.runSelected();
      }
    });
    this.list.addEventListener("pointermove", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (Number.isFinite(index) && index !== this.selected) {
        this.selected = index;
        this.paintSelection();
      }
    });
    this.list.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (!item) return;
      this.selected = Number(item.dataset.index);
      this.runSelected();
    });
  }

  open(initialQuery = ""): void {
    this.actions = this.actionProvider();
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openState = true;
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add("is-open"));
    this.input.value = initialQuery;
    this.selected = 0;
    this.applyFilter(initialQuery);
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove("is-open");
    this.root.hidden = true;
    this.onClose();
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  private applyFilter(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filtered = [...this.actions];
    } else {
      const scored: Array<{ action: PaletteAction; score: number }> = [];
      for (const action of this.actions) {
        const haystack = `${action.title} ${action.detail || ""} ${action.keywords || ""} ${action.group}`.toLowerCase();
        const index = haystack.indexOf(q);
        if (index >= 0) scored.push({ action, score: index + haystack.length * 0.02 });
      }
      scored.sort((a, b) => a.score - b.score);
      this.filtered = scored.map((item) => item.action);
    }
    this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1));
    this.render();
  }

  private render(): void {
    if (this.filtered.length === 0) {
      this.list.innerHTML = `<div class="palette__empty">${icon("search", 18)}<span>没有匹配的命令</span></div>`;
      return;
    }
    const groups = new Map<string, Array<{ action: PaletteAction; index: number }>>();
    this.filtered.forEach((action, index) => {
      const bucket = groups.get(action.group) || [];
      bucket.push({ action, index });
      groups.set(action.group, bucket);
    });

    const html: string[] = [];
    for (const [group, items] of groups) {
      html.push(`<div class="palette__group-label">${escapeHtml(group)}</div>`);
      for (const { action, index } of items) {
        html.push(`
          <button type="button" class="palette-item${index === this.selected ? " is-selected" : ""}" data-index="${index}" role="option" aria-selected="${index === this.selected}">
            <span class="palette-item__icon">${icon(action.icon || "command", 15)}</span>
            <span class="palette-item__body">
              <span class="palette-item__title">${escapeHtml(action.title)}</span>
              ${action.detail ? `<span class="palette-item__detail">${escapeHtml(action.detail)}</span>` : ""}
            </span>
            ${action.shortcut ? `<kbd class="palette-item__kbd">${escapeHtml(action.shortcut)}</kbd>` : ""}
          </button>`);
      }
    }
    this.list.innerHTML = html.join("");
    this.paintSelection(false);
  }

  private paintSelection(scroll = true): void {
    const items = [...this.list.querySelectorAll<HTMLElement>("[data-index]")];
    for (const item of items) {
      const selected = Number(item.dataset.index) === this.selected;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", String(selected));
      if (selected && scroll) item.scrollIntoView({ block: "nearest" });
    }
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    this.selected = (this.selected + delta + this.filtered.length) % this.filtered.length;
    this.paintSelection();
  }

  private runSelected(): void {
    const action = this.filtered[this.selected];
    if (!action) return;
    this.close();
    void action.run();
  }
}

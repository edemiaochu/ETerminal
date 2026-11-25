import { PRESETS } from "../liquid-glass/presets";
import { DEFAULT_GLASS_STYLE } from "../liquid-glass/types";
import type { PresetName, GlassParams } from "../liquid-glass/types";
import { FONT_STACKS, type CursorChoice, type FontChoice, type Settings, type WallpaperMode } from "../settings";
import { themeCardsMarkup } from "./theme-cards";
import type { ShellProfile } from "../types";
import { escapeHtml } from "./dom";
import { icon, type IconName } from "./icons";

interface SettingsPanelOptions {
  host: HTMLElement;
  settings: Settings;
  profiles: ShellProfile[];
  version: string;
  onChange: (settings: Settings) => void;
  onReset: () => Settings;
  onClose: () => void;
}

type ChoiceKey = "wallpaper" | "cursorStyle" | "fontChoice";
type RangeKey =
  | "fontSize"
  | "lineHeight"
  | "aiFontSize"
  | "glass.thickness"
  | "glass.dispersion"
  | "glass.roughness"
  | "glass.rimStrength"
  | "glass.bevel";

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly settingsHost: HTMLElement;
  private settings: Settings;
  private readonly profiles: ShellProfile[];
  private readonly onChange: (settings: Settings) => void;
  private readonly onReset: () => Settings;
  private readonly onClose: () => void;
  private openState = false;
  private activePreset: string | null = null;
  private previousFocus: HTMLElement | null = null;

  constructor(options: SettingsPanelOptions) {
    this.settings = options.settings;
    this.profiles = options.profiles;
    this.onChange = options.onChange;
    this.onReset = options.onReset;
    this.onClose = options.onClose;

    this.root = document.createElement("div");
    this.root.className = "settings-overlay";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="overlay-backdrop" data-role="backdrop"></div>
      <section class="settings" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1">
        <header class="settings__head">
          <span class="settings__mark">${icon("sliders", 18)}</span>
          <div class="settings__title">
            <span class="settings__eyebrow">PREFERENCES</span>
            <h2>外观与体验</h2>
            <p>所有更改即时生效，并保存在本机。</p>
          </div>
          <button type="button" class="ai-icon-button settings__close" data-role="close" title="关闭设置">${icon("x", 16)}</button>
        </header>
        <div class="settings__body">
          <section class="settings-section">
            <div class="settings-section__head">
              <h3>${icon("palette", 15)} 外观</h3>
              <p>主题、壁纸与动效</p>
            </div>
            <div class="settings-grid">
              <div class="theme-setting">
                <div class="setting-copy"><span class="setting-copy__label">主题</span><p>8 套工作台配色，即时生效</p></div>
                <div class="theme-grid" data-theme-grid>${themeCardsMarkup(this.settings.theme)}</div>
              </div>
              ${this.choiceRow("壁纸", "玻璃折射背后的环境", "wallpaper", [
                ["aurora", "极光", "sparkles"],
                ["clean", "柔光", "sun"],
                ["specimen", "标定", "layout"],
              ])}
              ${this.toggleRow("动效", "允许极光缓慢漂移与材质过渡", "motion")}
              ${this.toggleRow("工作区侧栏", "显示左侧会话与目录概览", "sidebarOpen")}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section__head">
              <h3>${icon("sparkles", 15)} 光学玻璃</h3>
              <p>边缘折射、色散与镜面高光</p>
            </div>
            <div class="preset-strip" role="group" aria-label="材质预设">
              ${(["Crystal", "Liquid", "Heavy", "Frost"] as PresetName[])
                .map(
                  (name) =>
                    `<button type="button" class="preset-chip" data-preset="${name}"><span class="preset-chip__dot" data-preset-dot="${name}"></span>${this.presetLabel(name)}</button>`,
                )
                .join("")}
            </div>
            <div class="settings-grid settings-grid--ranges">
              ${this.rangeRow("折射厚度", "玻璃边缘弯折背景的强度", "glass.thickness", 8, 150, 1, "px")}
              ${this.rangeRow("色散", "RGB 分离产生的彩虹边缘", "glass.dispersion", 0, 0.9, 0.01, "")}
              ${this.rangeRow("磨砂", "内部扩散，越高越朦胧", "glass.roughness", 0, 0.7, 0.01, "")}
              ${this.rangeRow("倒角", "边缘的圆滑过渡", "glass.bevel", 0, 80, 1, "px")}
              ${this.rangeRow("边缘高光", "Rim 与 Fresnel 的亮度", "glass.rimStrength", 0, 1.8, 0.05, "×")}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section__head">
              <h3>${icon("terminal", 15)} 终端</h3>
              <p>字体排印与交互方式</p>
            </div>
            <div class="settings-grid settings-grid--ranges">
              <div class="setting-row setting-row--select">
                <div class="setting-copy"><label for="set-font">等宽字体</label><p>JetBrains Mono 已内置</p></div>
                <div class="select-wrap"><select id="set-font" data-select="fontChoice">
                  <option value="jetbrains">JetBrains Mono</option>
                  <option value="cascadia">Cascadia Code</option>
                  <option value="consolas">Consolas</option>
                </select></div>
              </div>
              ${this.rangeRow("字号", "终端等宽字号", "fontSize", 11, 22, 1, "px")}
              ${this.rangeRow("行高", "更舒展的阅读密度", "lineHeight", 1.1, 1.9, 0.05, "")}
              ${this.choiceRow("光标", "非聚焦时自动变为描边", "cursorStyle", [
                ["bar", "竖线", "terminal"],
                ["block", "方块", "square"],
                ["underline", "下划线", "minus"],
              ])}
              ${this.toggleRow("光标闪烁", "输入时缓慢呼吸", "cursorBlink")}
              ${this.toggleRow("选中即复制", "松开鼠标即写入剪贴板", "copyOnSelect")}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section__head">
              <h3>${icon("sparkles", 15)} AI 阅读器</h3>
              <p>识别 Claude Code 等终端的 AI 回复</p>
            </div>
            <div class="settings-grid settings-grid--ranges">
              ${this.toggleRow("自动检测", "检测到 AI 输出时点亮阅读器按钮", "aiAuto")}
              ${this.toggleRow("自动跟随", "打开阅读器时始终滚动到最新内容", "aiFollow")}
              ${this.rangeRow("正文字号", "Markdown 阅读字号", "aiFontSize", 12, 19, 1, "px")}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section__head">
              <h3>${icon("command", 15)} 会话</h3>
              <p>新标签页使用的默认 Shell</p>
            </div>
            <div class="settings-grid">
              <div class="setting-row setting-row--select">
                <div class="setting-copy"><label for="set-shell">默认 Shell</label><p>也可以在每个标签上随时切换</p></div>
                <div class="select-wrap"><select id="set-shell" data-select="defaultProfile">
                  <option value="">跟随当前标签</option>
                  ${this.profiles
                    .map(
                      (profile) =>
                        `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`,
                    )
                    .join("")}
                </select></div>
              </div>
            </div>
          </section>
        </div>
        <footer class="settings__foot">
          <span class="settings__hint">${icon("info", 13)} ETerminal v${escapeHtml(options.version)} · 设置自动保存</span>
          <div class="settings__foot-actions">
            <button type="button" class="soft-button" data-role="reset">${icon("rotate", 14)}<span>恢复默认</span></button>
            <button type="button" class="soft-button soft-button--accent" data-role="close">完成</button>
          </div>
        </footer>
      </section>`;

    options.host.append(this.root);
    this.settingsHost = this.root;
    this.bind();
    this.sync();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  private presetLabel(name: PresetName): string {
    return { Crystal: "清透", Liquid: "液态", Heavy: "厚重", Frost: "磨砂" }[name];
  }

  private choiceRow(
    title: string,
    detail: string,
    key: ChoiceKey,
    options: Array<[string, string, IconName]>,
  ): string {
    return `<div class="setting-row setting-row--choices">
      <div class="setting-copy"><span class="setting-copy__label">${title}</span><p>${detail}</p></div>
      <div class="choice-group" data-choice="${key}" role="group" aria-label="${title}">
        ${options
          .map(
            ([value, label, glyph]) =>
              `<button type="button" class="choice" data-value="${value}" aria-pressed="false"><span class="choice__glyph">${icon(glyph, 13)}</span>${label}</button>`,
          )
          .join("")}
      </div>
    </div>`;
  }

  private toggleRow(title: string, detail: string, key: keyof Settings): string {
    return `<div class="setting-row setting-row--toggle">
      <div class="setting-copy"><span class="setting-copy__label">${title}</span><p>${detail}</p></div>
      <button type="button" class="switch" data-toggle="${String(key)}" role="switch" aria-checked="false"><span></span></button>
    </div>`;
  }

  private rangeRow(
    title: string,
    detail: string,
    key: RangeKey,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): string {
    return `<div class="setting-row setting-row--range">
      <div class="setting-copy"><label for="range-${key}">${title}</label><p>${detail}</p></div>
      <div class="range-control">
        <output data-output="${key}"></output>
        <input id="range-${key}" type="range" min="${min}" max="${max}" step="${step}" data-range="${key}" data-unit="${unit}" />
      </div>
    </div>`;
  }

  private bind(): void {
    this.root.querySelector('[data-role="backdrop"]')?.addEventListener("click", () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('[data-role="close"]').forEach((button) => {
      button.addEventListener("click", () => this.close());
    });
    this.root.querySelector('[data-role="reset"]')?.addEventListener("click", () => {
      this.settings = this.onReset();
      this.activePreset = null;
      this.sync();
    });

    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const themeCard = target.closest<HTMLButtonElement>("[data-theme-option]");
      if (themeCard) {
        const theme = themeCard.dataset.themeOption as Settings["theme"];
        this.settings.theme = theme;
        this.syncThemeCards();
        this.emit();
        return;
      }

      const choice = target.closest<HTMLButtonElement>(".choice[data-value]");
      if (choice) {
        const group = choice.closest<HTMLElement>("[data-choice]");
        const key = group?.dataset.choice as ChoiceKey | undefined;
        if (!key) return;
        const value = choice.dataset.value || "";
        if (key === "wallpaper") this.settings.wallpaper = value as WallpaperMode;
        else if (key === "cursorStyle") this.settings.cursorStyle = value as CursorChoice;
        else if (key === "fontChoice") this.settings.fontChoice = value as FontChoice;
        this.syncChoice(key);
        this.emit();
        return;
      }

      const preset = target.closest<HTMLButtonElement>("[data-preset]");
      if (preset) {
        const name = preset.dataset.preset as PresetName;
        this.activePreset = name;
        this.settings.glass = { ...this.settings.glass, ...PRESETS[name] } as GlassParams;
        this.sync();
        this.emit();
        return;
      }

      const toggle = target.closest<HTMLButtonElement>(".switch[data-toggle]");
      if (toggle) {
        const key = toggle.dataset.toggle as keyof Settings | undefined;
        if (!key) return;
        const current = Boolean(this.settings[key]);
        (this.settings as unknown as Record<string, unknown>)[key] = !current;
        toggle.setAttribute("aria-checked", String(!current));
        toggle.classList.toggle("is-on", !current);
        this.emit();
      }
    });

    this.root.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches("[data-range]")) {
        const key = input.dataset.range as RangeKey;
        const value = Number(input.value);
        this.setRangeValue(key, value);
        this.updateOutput(key, value, input.dataset.unit || "");
        if (key.startsWith("glass.")) this.activePreset = null;
        this.syncPresets();
        this.emit();
      }
    });

    this.root.addEventListener("change", (event) => {
      const select = event.target as HTMLSelectElement;
      if (!select.matches("[data-select]")) return;
      const key = select.dataset.select as "fontChoice" | "defaultProfile" | undefined;
      if (!key) return;
      if (key === "defaultProfile") this.settings.defaultProfile = select.value;
      else this.settings.fontChoice = select.value as FontChoice;
      this.emit();
    });

    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  private setRangeValue(key: RangeKey, value: number): void {
    if (key.startsWith("glass.")) {
      const prop = key.slice("glass.".length) as keyof GlassParams;
      (this.settings.glass as unknown as Record<string, number>)[prop] = value;
    } else {
      (this.settings as unknown as Record<string, number>)[key] = value;
    }
  }

  private getRangeValue(key: RangeKey): number {
    if (key.startsWith("glass.")) {
      const prop = key.slice("glass.".length) as keyof GlassParams;
      const value = this.settings.glass[prop];
      return typeof value === "number" ? value : 0;
    }
    const value = (this.settings as unknown as Record<string, unknown>)[key];
    return typeof value === "number" ? value : 0;
  }

  private updateOutput(key: RangeKey, value: number, unit: string): void {
    const output = this.root.querySelector<HTMLOutputElement>(`[data-output="${key}"]`);
    const input = this.root.querySelector<HTMLInputElement>(`[data-range="${key}"]`);
    if (input) {
      const min = Number(input.min);
      const max = Number(input.max);
      const pct = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
      input.style.setProperty("--range-pct", `${(pct * 100).toFixed(1)}%`);
    }
    if (!output) return;
    let display: string;
    if (key === "lineHeight") display = value.toFixed(2);
    else if (key === "glass.dispersion" || key === "glass.roughness") display = value.toFixed(2);
    else if (key === "glass.rimStrength") display = `${value.toFixed(2)}×`;
    else display = `${Math.round(value)}${unit}`;
    output.textContent = display;
  }

  private sync(): void {
    for (const key of ["wallpaper", "cursorStyle"] as ChoiceKey[]) {
      this.syncChoice(key);
    }
    this.syncThemeCards();
    for (const toggle of this.root.querySelectorAll<HTMLButtonElement>(".switch[data-toggle]")) {
      const key = toggle.dataset.toggle as keyof Settings | undefined;
      if (!key) continue;
      const value = Boolean(this.settings[key]);
      toggle.setAttribute("aria-checked", String(value));
      toggle.classList.toggle("is-on", value);
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>("[data-range]")) {
      const key = input.dataset.range as RangeKey;
      const value = this.getRangeValue(key);
      input.value = String(value);
      this.updateOutput(key, value, input.dataset.unit || "");
    }
    const fontSelect = this.root.querySelector<HTMLSelectElement>('[data-select="fontChoice"]');
    if (fontSelect) fontSelect.value = this.settings.fontChoice;
    const shellSelect = this.root.querySelector<HTMLSelectElement>('[data-select="defaultProfile"]');
    if (shellSelect) shellSelect.value = this.settings.defaultProfile;
    this.syncPresets();
    this.settingsHost.style.setProperty("--settings-font", FONT_STACKS[this.settings.fontChoice]);
  }

  private syncThemeCards(): void {
    const grid = this.root.querySelector<HTMLElement>("[data-theme-grid]");
    if (!grid) return;
    grid.innerHTML = themeCardsMarkup(this.settings.theme);
  }

  private syncChoice(key: ChoiceKey): void {
    const group = this.root.querySelector<HTMLElement>(`[data-choice="${key}"]`);
    if (!group) return;
    const value = this.settings[key];
    for (const button of group.querySelectorAll<HTMLButtonElement>(".choice")) {
      const active = button.dataset.value === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private syncPresets(): void {
    if (!this.activePreset) {
      // Detect a clean preset match only; custom materials highlight none.
      for (const name of Object.keys(PRESETS) as PresetName[]) {
        if (this.matchesPreset(name)) {
          this.activePreset = name;
          break;
        }
      }
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
      button.classList.toggle("is-active", button.dataset.preset === this.activePreset);
    }
  }

  private matchesPreset(name: PresetName): boolean {
    const preset = PRESETS[name];
    return (
      Math.abs(this.settings.glass.thickness - preset.thickness) < 0.5 &&
      Math.abs(this.settings.glass.dispersion - preset.dispersion) < 0.005 &&
      Math.abs(this.settings.glass.roughness - preset.roughness) < 0.005 &&
      Math.abs(this.settings.glass.ior - preset.ior) < 0.005
    );
  }

  private emit(): void {
    const next: Settings = {
      ...this.settings,
      glass: { ...this.settings.glass },
    };
    this.onChange(next);
  }

  open(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openState = true;
    this.root.hidden = false;
    this.sync();
    requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.root.querySelector<HTMLElement>(".settings")?.focus({ preventScroll: true });
    });
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove("is-open");
    this.root.hidden = true;
    this.onClose();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = null;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.activePreset = null;
    if (this.openState) this.sync();
  }

  resetMaterial(): void {
    this.settings.glass = {
      ...DEFAULT_GLASS_STYLE,
      ...PRESETS.Liquid,
    } as GlassParams;
    this.activePreset = "Liquid";
    this.sync();
    this.emit();
  }
}

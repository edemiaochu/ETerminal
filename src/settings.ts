import { PRESETS } from "./liquid-glass/presets";
import type { GlassParams } from "./liquid-glass/types";
import { coerceTheme, DEFAULT_THEME, type ThemeName } from "./themes";

export type { ThemeName } from "./themes";
export type WallpaperMode = "aurora" | "clean" | "specimen";
export type FontChoice = "jetbrains" | "cascadia" | "consolas";
export type CursorChoice = "bar" | "block" | "underline";

export interface Settings {
  theme: ThemeName;
  wallpaper: WallpaperMode;
  motion: boolean;
  glass: GlassParams;
  fontChoice: FontChoice;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorChoice;
  cursorBlink: boolean;
  copyOnSelect: boolean;
  defaultProfile: string;
  sidebarOpen: boolean;
  aiAuto: boolean;
  aiFollow: boolean;
  aiFontSize: number;
  aiPanelWidth: number;
}

const STORAGE_KEY = "eterminal.settings.v8";

export const FONT_STACKS: Record<FontChoice, string> = {
  jetbrains:
    '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", "Microsoft YaHei UI", "Noto Sans Mono CJK SC", Consolas, monospace',
  cascadia:
    '"Cascadia Code", "JetBrains Mono", "Cascadia Mono", "Microsoft YaHei UI", Consolas, monospace',
  consolas: 'Consolas, "JetBrains Mono", "Microsoft YaHei UI", monospace',
};

export function defaultSettings(): Settings {
  const reduced =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  return {
    theme: DEFAULT_THEME,
    wallpaper: "aurora",
    motion: !reduced,
    glass: {
      ...PRESETS.Liquid,
      ior: 1.54,
      thickness: 90,
      dispersion: 0.44,
      roughness: 0.07,
      bevel: 26,
      shadowDark: 0.28,
      shadowLight: 0.05,
      rimBase: 0.4,
      rimWidth: 2.5,
      rimStrength: 1.05,
      specularStrength: 1,
      fresnelStrength: 1.05,
      innerGlowStrength: 0.95,
    },
    fontChoice: "jetbrains",
    fontSize: 14,
    lineHeight: 1.45,
    cursorStyle: "bar",
    cursorBlink: true,
    copyOnSelect: false,
    defaultProfile: "",
    sidebarOpen: false,
    aiAuto: true,
    aiFollow: true,
    aiFontSize: 15,
    aiPanelWidth: 456,
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings> & { glass?: Partial<GlassParams> };
    const glass: GlassParams = { ...defaults.glass, ...(parsed.glass || {}) };
    const candidate: Settings = {
      ...defaults,
      ...parsed,
      glass,
      theme: coerceTheme(parsed.theme),
      wallpaper:
        parsed.wallpaper === "clean" || parsed.wallpaper === "specimen"
          ? parsed.wallpaper
          : "aurora",
      fontChoice:
        parsed.fontChoice === "cascadia" || parsed.fontChoice === "consolas"
          ? parsed.fontChoice
          : "jetbrains",
      cursorStyle:
        parsed.cursorStyle === "block" || parsed.cursorStyle === "underline"
          ? parsed.cursorStyle
          : "bar",
      motion: bool(parsed.motion, defaults.motion),
      cursorBlink: bool(parsed.cursorBlink, defaults.cursorBlink),
      copyOnSelect: bool(parsed.copyOnSelect, defaults.copyOnSelect),
      sidebarOpen: bool(parsed.sidebarOpen, defaults.sidebarOpen),
      aiAuto: bool(parsed.aiAuto, defaults.aiAuto),
      aiFollow: bool(parsed.aiFollow, defaults.aiFollow),
      fontSize: clamp(parsed.fontSize, 11, 24, defaults.fontSize),
      lineHeight: clamp(parsed.lineHeight, 1, 2, defaults.lineHeight),
      aiFontSize: clamp(parsed.aiFontSize, 12, 20, defaults.aiFontSize),
      aiPanelWidth: clamp(parsed.aiPanelWidth, 340, 720, defaults.aiPanelWidth),
      defaultProfile: typeof parsed.defaultProfile === "string" ? parsed.defaultProfile : "",
    };
    // Guard numeric material values so a hand-edited file cannot break the shader.
    candidate.glass = {
      ...glass,
      ior: clamp(glass.ior, 1.05, 2.2, defaults.glass.ior),
      thickness: clamp(glass.thickness, 0, 160, defaults.glass.thickness),
      dispersion: clamp(glass.dispersion, 0, 1, defaults.glass.dispersion),
      roughness: clamp(glass.roughness, 0, 1, defaults.glass.roughness),
      bevel: clamp(glass.bevel, 0, 120, defaults.glass.bevel),
    };
    return candidate;
  } catch {
    return defaults;
  }
}

let saveTimer: number | undefined;

export function saveSettings(settings: Settings): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or disabled — settings are still live for this session */
    }
  }, 120);
}

export function resetSettings(): Settings {
  const defaults = defaultSettings();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return defaults;
}

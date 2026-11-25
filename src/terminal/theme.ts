import type { ITheme, ITerminalOptions } from "@xterm/xterm";
import { FONT_STACKS, type Settings } from "../settings";
import { getTheme, terminalSurfaces } from "../themes";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return `rgba(124, 240, 216, ${alpha})`;
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

export function xtermTheme(settings: Settings): ITheme {
  const surfaces = terminalSurfaces(settings.theme);
  const accent = getTheme(settings.theme).from;
  if (settings.theme === "light") {
    return {
      background: surfaces.terminal,
      foreground: "#1b2230",
      cursor: accent,
      cursorAccent: surfaces.terminal,
      selectionBackground: hexToRgba(accent, 0.2),
      selectionForeground: "#101821",
      selectionInactiveBackground: "rgba(30, 40, 55, 0.10)",
      black: "#28303f",
      red: "#bd3548",
      green: "#167457",
      yellow: "#8a6100",
      blue: "#2f5bc7",
      magenta: "#7440c8",
      cyan: "#0a7285",
      white: "#e6e6e0",
      brightBlack: "#6a7485",
      brightRed: "#d94a5c",
      brightGreen: "#1d8e6a",
      brightYellow: "#a77c0c",
      brightBlue: "#426fdb",
      brightMagenta: "#8d58df",
      brightCyan: "#0f879c",
      brightWhite: "#ffffff",
      scrollbarSliderBackground: "rgba(20, 30, 45, 0.13)",
      scrollbarSliderHoverBackground: "rgba(20, 30, 45, 0.22)",
      scrollbarSliderActiveBackground: "rgba(20, 30, 45, 0.3)",
    };
  }
  return {
    // Keep the terminal canvas opaque: translucent WebGL backgrounds leave
    // stale glyph/cursor pixels when editing quickly (visible ghosting).
    background: surfaces.terminal,
    foreground: "#d9e3f2",
    cursor: accent,
    cursorAccent: surfaces.terminal,
    selectionBackground: hexToRgba(accent, 0.24),
    selectionForeground: "#f3fffb",
    selectionInactiveBackground: "rgba(160, 180, 205, 0.13)",
    black: "#1b2433",
    red: "#ff7e8c",
    green: "#79e3b5",
    yellow: "#f2d57c",
    blue: "#88a9ff",
    magenta: "#c8a5ff",
    cyan: "#79e8f7",
    white: "#dbe4f2",
    brightBlack: "#5e6b80",
    brightRed: "#ffa3ab",
    brightGreen: "#a4f2ce",
    brightYellow: "#ffe9a8",
    brightBlue: "#aec3ff",
    brightMagenta: "#ddc4ff",
    brightCyan: "#a9f5ff",
    brightWhite: "#ffffff",
    scrollbarSliderBackground: "rgba(220, 235, 255, 0.075)",
    scrollbarSliderHoverBackground: "rgba(220, 235, 255, 0.16)",
    scrollbarSliderActiveBackground: "rgba(220, 235, 255, 0.24)",
    overviewRulerBorder: "rgba(255,255,255,0.04)",
  };
}

export function xtermOptions(settings: Settings): ITerminalOptions {
  return {
    allowProposedApi: true,
    allowTransparency: false,
    altClickMovesCursor: true,
    convertEol: false,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle,
    cursorWidth: 2,
    cursorInactiveStyle: "outline",
    customGlyphs: true,
    drawBoldTextInBrightColors: true,
    fastScrollSensitivity: 5,
    fontFamily: FONT_STACKS[settings.fontChoice],
    fontSize: settings.fontSize,
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0.1,
    lineHeight: settings.lineHeight,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    minimumContrastRatio: 4,
    rescaleOverlappingGlyphs: true,
    rightClickSelectsWord: false,
    scrollOnUserInput: true,
    scrollback: 8000,
    smoothScrollDuration: 90,
    theme: xtermTheme(settings),
    windowsPty: navigator.platform.toLowerCase().includes("win") ? { backend: "conpty" } : undefined,
  };
}

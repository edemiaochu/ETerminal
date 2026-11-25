export type ThemeName =
  | "aurora"
  | "ocean"
  | "forest"
  | "ember"
  | "violet"
  | "black"
  | "graphite"
  | "light";

export interface ThemeDef {
  id: ThemeName;
  name: string;
  from: string;
  to: string;
  base: string;
  light?: boolean;
}

/** Shared with the Glass Workspace UI design system. */
export const THEMES: ThemeDef[] = [
  { id: "aurora", name: "极光", from: "#a855f7", to: "#22d3ee", base: "#191b23" },
  { id: "ocean", name: "深海", from: "#38bdf8", to: "#2dd4bf", base: "#0f1822" },
  { id: "forest", name: "森林", from: "#4ade80", to: "#2dd4bf", base: "#101a14" },
  { id: "ember", name: "熔岩", from: "#fb923c", to: "#f43f5e", base: "#1a1210" },
  { id: "violet", name: "紫罗兰", from: "#c084fc", to: "#f472b6", base: "#1b1423" },
  { id: "black", name: "纯黑", from: "#8e8e96", to: "#2b2b30", base: "#080808" },
  { id: "graphite", name: "黑灰", from: "#a1a1aa", to: "#3f3f46", base: "#242424" },
  {
    id: "light",
    name: "明亮",
    from: "#7c3aed",
    to: "#0891b2",
    base: "#f3f4f6",
    light: true,
  },
];

export const DEFAULT_THEME: ThemeName = "aurora";

export function getTheme(id: ThemeName): ThemeDef {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function isLightTheme(id: ThemeName): boolean {
  return id === "light";
}

/** Migrate the old dark/light ids and reject hand-edited values. */
export function coerceTheme(value: unknown): ThemeName {
  if (value === "dark") return "aurora";
  if (typeof value === "string" && THEMES.some((theme) => theme.id === value)) {
    return value as ThemeName;
  }
  return DEFAULT_THEME;
}


/** Flat terminal surfaces. Keep xterm and the DOM chrome on the same color. */
export interface TerminalSurfaces {
  terminal: string;
  aiPanel: string;
}

export const TERMINAL_SURFACES: Record<ThemeName, TerminalSurfaces> = {
  aurora: { terminal: "#08060f", aiPanel: "#0b0914" },
  ocean: { terminal: "#05121b", aiPanel: "#071823" },
  forest: { terminal: "#07130c", aiPanel: "#0a1810" },
  ember: { terminal: "#150b08", aiPanel: "#1a0e0a" },
  violet: { terminal: "#120a19", aiPanel: "#170e20" },
  black: { terminal: "#050505", aiPanel: "#0b0b0c" },
  graphite: { terminal: "#151517", aiPanel: "#1b1b1e" },
  light: { terminal: "#fbfaf6", aiPanel: "#f6f7f3" },
};

export function terminalSurfaces(theme: ThemeName): TerminalSurfaces {
  return TERMINAL_SURFACES[theme] ?? TERMINAL_SURFACES.aurora;
}

export type ShellKind = "powershell" | "bash" | "cmd" | "wsl";

export interface ShellProfile {
  id: string;
  name: string;
  short: string;
  kind: ShellKind;
  description: string;
  available: boolean;
}

export interface BootstrapInfo {
  version: string;
  platform: string;
  home: string;
  locale: string;
  profiles: ShellProfile[];
  appCwd: string;
  claude: boolean;
  demo: string;
  isDev: boolean;
  debug: boolean;
}

export interface PtyCreateOptions {
  profileId: string;
  cwd?: string;
  cols: number;
  rows: number;
  /** Renderer-generated id so early PTY output cannot race the create reply. */
  clientId: string;
}

export interface PtySessionInfo {
  id: string;
  pid: number;
  profileId: string;
  cwd: string;
}

export interface PtyExitInfo {
  exitCode: number;
  signal?: number;
}

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

export interface ETermAPI {
  bootstrap(): Promise<BootstrapInfo>;
  createPty(options: PtyCreateOptions): Promise<PtySessionInfo>;
  writePty(id: string, data: string): void;
  resizePty(id: string, cols: number, rows: number): void;
  killPty(id: string): void;
  onPtyData(callback: (id: string, data: string) => void): () => void;
  onPtyExit(callback: (id: string, info: PtyExitInfo) => void): () => void;
  gitBranch(cwd: string): Promise<string | null>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  windowControl(action: "minimize" | "close" | "toggle-maximize" | "toggle-fullscreen"): Promise<void>;
  windowState(): Promise<WindowState>;
  onWindowState(callback: (state: WindowState) => void): () => void;
}

declare global {
  interface Window {
    eterm: ETermAPI;
  }
}

export {};

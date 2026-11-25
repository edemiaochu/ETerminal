/* ETerminal — Electron main process.
 * Owns real PTY sessions, shell detection, window chrome and small native bridges.
 */
const { app, BrowserWindow, clipboard, ipcMain, screen, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const pty = require("@lydell/node-pty");

const IS_DEV = process.argv.includes("--dev");
const CAPTURE_PATH = process.env.ETERMINAL_CAPTURE || "";
const DEMO = process.env.ETERMINAL_DEMO || "";
const APP_NAME = "ETerminal";

// Capture mode must never interfere with a developer's running app: use an
// isolated profile and single-instance lock for screenshot sessions.
if (CAPTURE_PATH) {
  app.setPath("userData", path.join(os.tmpdir(), `eterminal-capture-${process.pid}`));
}

let mainWindow = null;
/** @type {Map<string, {proc: import('@lydell/node-pty').IPty, profile: string}>} */
const sessions = new Map();

/* ------------------------------------------------------------------ */
/* Shell discovery                                                     */
/* ------------------------------------------------------------------ */

const WINDOWS = process.platform === "win32";
const EXE = WINDOWS ? ".exe" : "";

function existsFile(candidate) {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsFile(candidate)) return candidate;
  }
  return null;
}

function pathLookup(names) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const entry of pathEntries) {
      const candidate = path.join(entry, name);
      if (existsFile(candidate)) return candidate;
    }
  }
  return null;
}

function findGitBash() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA || "";
  const known = [
    path.join(programFiles, "Git", "bin", "bash.exe"),
    path.join(programFilesX86, "Git", "bin", "bash.exe"),
    path.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  const fromPath = pathLookup(["bash.exe"]);
  const usableFromPath =
    fromPath && !/WindowsApps/i.test(fromPath) && !/System32/i.test(fromPath) ? fromPath : null;
  return firstExisting([...known, usableFromPath]);
}

function findPwsh() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  return firstExisting([
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    path.join(programFiles, "PowerShell", "7-preview", "pwsh.exe"),
    pathLookup(["pwsh.exe"]),
  ]);
}

function findPowershell() {
  return firstExisting([
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    pathLookup(["powershell.exe"]),
  ]);
}

function findCmd() {
  return firstExisting([
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
    pathLookup(["cmd.exe"]),
  ]);
}

function findWsl() {
  return firstExisting([
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe"),
    pathLookup(["wsl.exe"]),
  ]);
}

function detectClaude() {
  return Boolean(
    pathLookup(["claude.cmd", "claude.exe", "claude"]) ||
      existsFile(path.join(process.env.APPDATA || "", "npm", "claude.cmd")),
  );
}

function buildProfiles() {
  /** @type {Array<Record<string, unknown>>} */
  const profiles = [];
  const pwsh = findPwsh();
  const powershell = findPowershell();
  const gitBash = findGitBash();
  const cmd = findCmd();
  const wsl = findWsl();

  if (powershell) {
    profiles.push({
      id: "powershell",
      name: "Windows PowerShell",
      short: "PS",
      kind: "powershell",
      description: "Windows 内置 PowerShell 5.1",
      command: powershell,
    });
  }
  if (pwsh) {
    profiles.push({
      id: "pwsh",
      name: "PowerShell 7",
      short: "PS7",
      kind: "powershell",
      description: "跨平台 PowerShell 7",
      command: pwsh,
    });
  }
  if (gitBash) {
    profiles.push({
      id: "git-bash",
      name: "Git Bash",
      short: "BASH",
      kind: "bash",
      description: "Git for Windows · bash 5",
      command: gitBash,
    });
  }
  if (cmd) {
    profiles.push({
      id: "cmd",
      name: "Command Prompt",
      short: "CMD",
      kind: "cmd",
      description: "经典 Windows 命令提示符",
      command: cmd,
    });
  }
  if (wsl) {
    profiles.push({
      id: "wsl",
      name: "WSL",
      short: "WSL",
      kind: "wsl",
      description: "Windows Subsystem for Linux",
      command: wsl,
    });
  }

  // A small, stable subset of metadata is all the renderer needs.
  return profiles.map(({ command, ...profile }) => ({ ...profile, available: true }));
}

function getProfileById(id) {
  const profiles = buildProfiles();
  return profiles.find((profile) => profile.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Shell integration                                                   */
/* ------------------------------------------------------------------ */

function userDataPath(...parts) {
  return path.join(app.getPath("userData"), ...parts);
}

function powershellBootstrap() {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    "$env:TERM = 'xterm-256color'",
    "$env:COLORTERM = 'truecolor'",
    "$env:TERM_PROGRAM = 'ETerminal'",
    "try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}",
    "try { $OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}",
    "try { $null = & chcp.com 65001 } catch {}",
    "if (-not (Test-Path variable:global:__ETerminalOrigPrompt)) {",
    "  try { $global:__ETerminalOrigPrompt = $function:prompt } catch {}",
    "}",
    "function global:prompt {",
    "  $cwd = (Get-Location).Path",
    "  $uriPath = $cwd.Replace([string][char]92, '/')",
    "  $e = [char]27",
    "  $b = [char]92",
    "  try { [Console]::Write(\"$e]7;file:///$uriPath$e$b\") } catch {}",
    "  if ($global:__ETerminalOrigPrompt) { & $global:__ETerminalOrigPrompt } else { \"PS $cwd> \" }",
    "}",
  ];
  return lines.join("\n");
}

function writeBashIntegration() {
  const dir = userDataPath("shell-integration");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bash-rc.sh");
  const script = [
    "# ETerminal shell integration — generated file, safe to delete.",
    "[ -f /etc/profile ] && . /etc/profile",
    "if [ -f \"$HOME/.bash_profile\" ]; then . \"$HOME/.bash_profile\"; elif [ -f \"$HOME/.bashrc\" ]; then . \"$HOME/.bashrc\"; fi",
    "if [ -z \"${__ETERMINAL_OSC7:-}\" ]; then",
    "  __ETERMINAL_OSC7=1",
    "  __eterminal_osc7() {",
    "    local p",
    "    p=\"$(pwd -W 2>/dev/null || pwd)\"",
    "    printf '\\033]7;file:///%s\\033\\\\' \"$p\"",
    "  }",
    "  if [ -n \"${PROMPT_COMMAND:-}\" ]; then",
    "    PROMPT_COMMAND=\"__eterminal_osc7; ${PROMPT_COMMAND}\"",
    "  else",
    "    PROMPT_COMMAND=\"__eterminal_osc7\"",
    "  fi",
    "fi",
    "",
  ].join("\n");
  fs.writeFileSync(file, script, "utf8");
  return file;
}

function windowsPathToMsys(winPath) {
  const normalized = winPath.replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`);
}

/* ------------------------------------------------------------------ */
/* PTY lifecycle                                                       */
/* ------------------------------------------------------------------ */

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function resolveCwd(profile, requested) {
  if (requested && typeof requested === "string") {
    try {
      if (profile.kind === "wsl") return requested;
      if (fs.statSync(requested).isDirectory()) return requested;
    } catch {
      /* fall through */
    }
  }
  return os.homedir();
}

function createSession(profileId, options = {}) {
  const profile = getProfileById(profileId) || getProfileById("powershell") || buildProfiles()[0];
  if (!profile) throw new Error("No shells are available on this system.");

  const full = {
    powershell: findPowershell(),
    pwsh: findPwsh(),
    "git-bash": findGitBash(),
    cmd: findCmd(),
    wsl: findWsl(),
  }[profile.id];

  if (!full) throw new Error(`Shell not found: ${profile.name}`);

  const cwd = resolveCwd(profile, options.cwd);
  const cols = clampInt(options.cols, 2, 500, 100);
  const rows = clampInt(options.rows, 1, 240, 30);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "ETerminal";
  env.TERM_PROGRAM_VERSION = app.getVersion();

  let file = full;
  let args = [];

  if (profile.kind === "powershell") {
    const encoded = Buffer.from(powershellBootstrap(), "utf16le").toString("base64");
    args = ["-NoLogo", "-NoExit", "-EncodedCommand", encoded];
  } else if (profile.kind === "bash") {
    const integration = writeBashIntegration();
    env.CHERE_INVOKING = "1";
    env.LANG = env.LANG || "en_US.UTF-8";
    args = ["--rcfile", windowsPathToMsys(integration), "-i"];
  } else if (profile.kind === "cmd") {
    args = ["/K", "chcp 65001>nul"];
  } else if (profile.kind === "wsl") {
    if (cwd && cwd !== os.homedir()) args = ["--cd", cwd];
  }

  const requestedId = typeof options.clientId === "string" ? options.clientId : "";
  const id =
    /^[A-Za-z0-9_-]{8,80}$/.test(requestedId) && !sessions.has(requestedId)
      ? requestedId
      : crypto.randomUUID();

  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: profile.kind === "wsl" ? os.homedir() : cwd,
    env,
    useConpty: WINDOWS ? true : undefined,
  });

  sessions.set(id, { proc, profile: profile.id });

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", id, data);
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:exit", id, { exitCode, signal });
    }
  });

  return { id, pid: proc.pid, profileId: profile.id, cwd };
}

function killSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try {
    session.proc.kill();
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function windowIconPath() {
  const dir = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "build");
  const ico = path.join(dir, "icon.ico");
  const png = path.join(dir, "icon.png");
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function stateFile() {
  return userDataPath("window-state.json");
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (typeof state.width !== "number" || typeof state.height !== "number") return null;
    return state;
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.getNormalBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...bounds, maximized: win.isMaximized() }, null, 2),
      "utf8",
    );
  } catch {
    /* non-fatal */
  }
}

function clampedBounds(state) {
  if (!state) return { width: 1320, height: 860 };
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    return (
      state.x + state.width > area.x + 40 &&
      state.x < area.x + area.width - 40 &&
      state.y + 40 < area.y + area.height &&
      state.y + state.height > area.y + 40
    );
  });
  if (!visible) return { width: 1320, height: 860 };
  return {
    x: state.x,
    y: state.y,
    width: Math.max(980, Math.min(state.width, 3200)),
    height: Math.max(620, Math.min(state.height, 2200)),
  };
}

function createWindow() {
  const saved = readWindowState();
  const bounds = CAPTURE_PATH ? { width: 1485, height: 1000 } : clampedBounds(saved);

  const windowIcon = windowIconPath();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: "#05070c",
    title: APP_NAME,
    icon: windowIcon,
    autoHideMenuBar: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (windowIcon) mainWindow.setIcon(windowIcon);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  if (saved && saved.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (CAPTURE_PATH) mainWindow.focus();
  });

  const sendWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state", {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
      focused: mainWindow.isFocused(),
    });
  };

  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur"]) {
    mainWindow.on(event, sendWindowState);
  }

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 350);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("close", () => saveWindowState(mainWindow));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  const devUrl = "http://localhost:5273/";
  const distIndex = path.join(__dirname, "..", "dist", "renderer", "index.html");
  const query = DEMO ? `?demo=${encodeURIComponent(DEMO)}` : "";
  if (IS_DEV) {
    mainWindow.loadURL(devUrl + query);
  } else {
    mainWindow.loadFile(distIndex, DEMO ? { query: { demo: DEMO } } : undefined);
  }

  if (CAPTURE_PATH) {
    mainWindow.webContents.once("did-finish-load", () => {
      const wait = Number(process.env.ETERMINAL_CAPTURE_DELAY || 4200);
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(CAPTURE_PATH), { recursive: true });
          fs.writeFileSync(CAPTURE_PATH, image.toPNG());
          console.log(`[capture] wrote ${CAPTURE_PATH}`);
        } catch (error) {
          console.error("[capture] failed", error);
        } finally {
          app.exit(0);
        }
      }, wait);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openExternalSafely(url) {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      shell.openExternal(url);
    }
  } catch {
    /* ignore malformed URLs */
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle("app:bootstrap", () => ({
    version: app.getVersion(),
    platform: process.platform,
    home: os.homedir(),
    locale: app.getLocale(),
    profiles: buildProfiles(),
    appCwd: process.cwd(),
    claude: detectClaude(),
    demo: DEMO,
    isDev: IS_DEV,
    debug: Boolean(CAPTURE_PATH) || process.env.ETERMINAL_DEBUG === "1",
  }));

  ipcMain.handle("pty:create", (event, options) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Bad sender");
    const safe = options && typeof options === "object" ? options : {};
    return createSession(String(safe.profileId || "powershell"), {
      cwd: typeof safe.cwd === "string" ? safe.cwd : undefined,
      cols: clampInt(safe.cols, 2, 500, 100),
      rows: clampInt(safe.rows, 1, 240, 30),
      clientId: typeof safe.clientId === "string" ? safe.clientId : undefined,
    });
  });

  ipcMain.on("pty:write", (event, id, data) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    const session = sessions.get(String(id));
    if (session && typeof data === "string") {
      try {
        session.proc.write(data);
      } catch {
        /* session may have exited */
      }
    }
  });

  ipcMain.on("pty:resize", (event, id, cols, rows) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    const session = sessions.get(String(id));
    if (!session) return;
    try {
      session.proc.resize(clampInt(cols, 2, 500, 100), clampInt(rows, 1, 240, 30));
    } catch {
      /* ignore transient resize races */
    }
  });

  ipcMain.on("pty:kill", (event, id) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    killSession(String(id));
  });

  ipcMain.handle("git:branch", (_event, cwd) => readGitBranch(String(cwd || "")));

  ipcMain.handle("clipboard:read", () => clipboard.readText());
  ipcMain.handle("clipboard:write", (_event, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });

  ipcMain.handle("shell:open-external", (_event, url) => {
    openExternalSafely(String(url || ""));
    return true;
  });

  ipcMain.handle("window:control", (_event, action) => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    else if (action === "close") mainWindow.close();
    else if (action === "toggle-maximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === "toggle-fullscreen") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  ipcMain.handle("window:state", () => {
    if (!mainWindow) return { maximized: false, fullscreen: false, focused: true };
    return {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
      focused: mainWindow.isFocused(),
    };
  });
}

function readGitBranch(startCwd) {
  if (!startCwd) return null;
  let dir;
  try {
    if (!fs.statSync(startCwd).isDirectory()) return null;
    dir = startCwd;
  } catch {
    return null;
  }

  for (let depth = 0; depth < 24; depth += 1) {
    const gitPath = path.join(dir, ".git");
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        return readHead(path.join(gitPath, "HEAD"));
      }
      if (stat.isFile()) {
        const contents = fs.readFileSync(gitPath, "utf8").trim();
        const match = /^gitdir:\s*(.+)$/i.exec(contents);
        if (match) {
          const gitdir = path.resolve(dir, match[1].trim());
          return readHead(path.join(gitdir, "HEAD"));
        }
      }
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readHead(headPath) {
  try {
    const head = fs.readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice(4).trim();
      return ref.replace(/^refs\/heads\//, "");
    }
    return head.slice(0, 8);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.eterminal.app");
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    for (const id of [...sessions.keys()]) killSession(id);
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    for (const id of [...sessions.keys()]) killSession(id);
  });
}

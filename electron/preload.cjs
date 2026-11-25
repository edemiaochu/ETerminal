/* ETerminal preload — the only bridge exposed to the renderer. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eterm", {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),

  createPty: (options) => ipcRenderer.invoke("pty:create", options),
  writePty: (id, data) => ipcRenderer.send("pty:write", id, data),
  resizePty: (id, cols, rows) => ipcRenderer.send("pty:resize", id, cols, rows),
  killPty: (id) => ipcRenderer.send("pty:kill", id),

  onPtyData: (callback) => {
    const handler = (_event, id, data) => callback(id, data);
    ipcRenderer.on("pty:data", handler);
    return () => ipcRenderer.removeListener("pty:data", handler);
  },
  onPtyExit: (callback) => {
    const handler = (_event, id, info) => callback(id, info);
    ipcRenderer.on("pty:exit", handler);
    return () => ipcRenderer.removeListener("pty:exit", handler);
  },

  gitBranch: (cwd) => ipcRenderer.invoke("git:branch", cwd),
  clipboardRead: () => ipcRenderer.invoke("clipboard:read"),
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", text),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  windowControl: (action) => ipcRenderer.invoke("window:control", action),
  windowState: () => ipcRenderer.invoke("window:state"),
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
});

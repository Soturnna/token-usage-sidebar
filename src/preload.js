const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sidebar", {
  onUsage: (cb) => ipcRenderer.on("usage", (_e, data) => cb(data)),
  setInteractive: (v) => ipcRenderer.send("set-interactive", v),
  openPanel: () => ipcRenderer.send("open-panel"),
  refresh: () => ipcRenderer.send("refresh"),
  move: (screenY, grabY) => ipcRenderer.send("sidebar-move", screenY, grabY),
  moveEnd: () => ipcRenderer.send("sidebar-move-end"),
  quit: () => ipcRenderer.send("quit"),
  openClaudeMenu: () => ipcRenderer.send("open-claude-menu"),
  onConfig: (cb) => ipcRenderer.on("config", (_e, cfg) => cb(cfg)),
  onAgent: (cb) => ipcRenderer.on("agent", (_e, resumo) => cb(resumo)),
  getAgent: () => ipcRenderer.invoke("get-agent"),
  onCursor: (cb) => ipcRenderer.on("cursor", (_e, p) => cb(p)),
  cursorHz: (hz) => ipcRenderer.send("cursor-hz", hz),
});

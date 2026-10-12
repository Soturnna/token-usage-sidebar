const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sidebar", {
  onUsage: (cb) => ipcRenderer.on("usage", (_e, data) => cb(data)),
  expand: () => ipcRenderer.send("expand"),
  collapse: () => ipcRenderer.send("collapse"),
  openPanel: () => ipcRenderer.send("open-panel"),
  refresh: () => ipcRenderer.send("refresh"),
  move: (screenY, grabY) => ipcRenderer.send("sidebar-move", screenY, grabY),
  moveEnd: () => ipcRenderer.send("sidebar-move-end"),
  quit: () => ipcRenderer.send("quit"),
});

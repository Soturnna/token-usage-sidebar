const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelApi", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  getUsage: () => ipcRenderer.invoke("get-usage"),
  getVersion: () => ipcRenderer.invoke("get-version"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  refresh: () => ipcRenderer.send("refresh"),
  close: () => ipcRenderer.send("panel-close"),
  quit: () => ipcRenderer.send("quit"),
  onUsage: (cb) => ipcRenderer.on("usage", (_e, data) => cb(data)),
});

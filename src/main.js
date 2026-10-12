const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { readUsage } = require("./usage");
const live = require("./live");

// Repositório para a verificação de atualizações (preenchido após a publicação).
const REPO = "";
const APP_NAME = "Token Usage Sidebar";

const COLLAPSED = { w: 94, h: 384 };
const EXPANDED = { w: 424, h: 384 };
const MARGIN = 0;
const DEFAULTS = { refreshMin: 5, autostart: false, showWidget: true, primary: "7d", posY: null };

let sidebar = null;
let panel = null;
let tray = null;
let timer = null;
let config = { ...DEFAULTS };
let lastLive = null;

const ICON = path.join(__dirname, "..", "assets", "icon.png");
const CONFIG_PATH = () => path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8")) }; }
  catch { config = { ...DEFAULTS }; }
  return config;
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2)); } catch { /* ignora */ }
}
function applyAutostart() {
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  try { app.setLoginItemSettings({ openAtLogin: !!config.autostart, path: exePath }); } catch { /* ignora */ }
}

function placeSidebar(w, h) {
  if (!sidebar) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = width - w - MARGIN;
  let y = config.posY != null ? config.posY : Math.round((height - h) / 2);
  y = Math.max(0, Math.min(height - h, y));
  sidebar.setBounds({ x, y, width: w, height: h });
}

function createSidebar() {
  sidebar = new BrowserWindow({
    width: COLLAPSED.w, height: COLLAPSED.h,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    fullscreenable: false, maximizable: false, minimizable: false,
    show: !!config.showWidget,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  sidebar.setAlwaysOnTop(true, "screen-saver");
  sidebar.loadFile(path.join(__dirname, "renderer", "index.html"));
  placeSidebar(COLLAPSED.w, COLLAPSED.h);
  sidebar.webContents.on("did-finish-load", tick);
}

function createPanel() {
  panel = new BrowserWindow({
    width: 460, height: 660, show: false,
    frame: false, transparent: true, resizable: false, hasShadow: true,
    minimizable: true, maximizable: false, skipTaskbar: false,
    backgroundColor: "#00000000", title: APP_NAME, icon: ICON,
    webPreferences: { preload: path.join(__dirname, "preload-panel.js"), contextIsolation: true, nodeIntegration: false },
  });
  panel.loadFile(path.join(__dirname, "renderer", "panel.html"));
  panel.on("close", (e) => { e.preventDefault(); panel.hide(); });
}

function openPanel() {
  if (!panel) createPanel();
  panel.show(); panel.focus();
}

function setWidgetVisible(v) {
  config.showWidget = v; saveConfig();
  if (!sidebar) return;
  if (v) { sidebar.show(); tick(); } else sidebar.hide();
  rebuildTray();
}

async function resolveUsage() {
  const hist = readUsage();
  const extra = hist.ok
    ? { samples: hist.samples, peakSd: hist.peakSd, peakFh: hist.peakFh, count: hist.count, daysActive: hist.daysActive, org: hist.org }
    : { samples: [], peakSd: null, peakFh: null, count: null, daysActive: null, org: null };
  const l = await live.getLive();
  if (l.ok) {
    lastLive = { fh: l.fh, sd: l.sd, reset5h: l.reset5h, reset7d: l.reset7d, status: l.status, t: l.t };
    return { ok: true, source: "live", ...lastLive, ...extra };
  }
  if (lastLive) {
    return { ok: true, source: "live", stale: true, ...lastLive, ...extra };
  }
  if (hist.ok) return { ...hist, source: "local", liveError: l.error };
  return { ok: false, error: hist.error || l.error || "sem-dados", liveError: l.error };
}

async function tick() {
  const data = await resolveUsage();
  for (const w of [sidebar, panel]) {
    if (w && !w.isDestroyed()) w.webContents.send("usage", data);
  }
}
function startTimer() {
  if (timer) clearInterval(timer);
  const ms = Math.max(1, Number(config.refreshMin) || 5) * 60 * 1000;
  timer = setInterval(tick, ms);
}

function compareVer(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i] || "0", 10) || 0) - (parseInt(pb[i] || "0", 10) || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
async function checkUpdate() {
  if (!REPO) return { ok: false, error: "no-repo" };
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "token-usage-sidebar", Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return { ok: false, error: "none" };
    if (!res.ok) return { ok: false, error: "http", httpStatus: res.status };
    const j = await res.json();
    const latest = String(j.tag_name || "").replace(/^v/, "");
    const current = app.getVersion();
    return { ok: true, current, latest, newer: compareVer(latest, current) > 0, url: j.html_url };
  } catch (e) {
    return { ok: false, error: "network", detail: String((e && e.message) || e) };
  }
}

function rebuildTray() {
  if (!tray) return;
  const freqs = [1, 5, 15, 60];
  const menu = Menu.buildFromTemplate([
    { label: "Atualizar agora", click: tick },
    {
      label: "Frequência de atualização",
      submenu: freqs.map((m) => ({
        label: m === 60 ? "A cada hora" : `A cada ${m} min`,
        type: "radio", checked: config.refreshMin === m,
        click: () => { config.refreshMin = m; saveConfig(); startTimer(); },
      })),
    },
    { type: "separator" },
    { label: "Mostrar widget", type: "checkbox", checked: !!config.showWidget, click: (i) => setWidgetVisible(i.checked) },
    { label: "Iniciar com o Windows", type: "checkbox", checked: !!config.autostart, click: (i) => { config.autostart = i.checked; saveConfig(); applyAutostart(); } },
    { label: "Abrir painel de controle", click: openPanel },
    { type: "separator" },
    { label: "Sair", click: () => app.exit(0) },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  tray.on("click", openPanel);
  rebuildTray();
}

// ----- IPC -----
ipcMain.on("expand", () => placeSidebar(EXPANDED.w, EXPANDED.h));
ipcMain.on("collapse", () => placeSidebar(COLLAPSED.w, COLLAPSED.h));
ipcMain.on("sidebar-move", (_e, screenY, grabY) => {
  if (!sidebar) return;
  const b = sidebar.getBounds();
  const { height } = screen.getPrimaryDisplay().workAreaSize;
  let y = Math.round(Number(screenY) - Number(grabY));
  y = Math.max(0, Math.min(height - b.height, y));
  sidebar.setBounds({ x: b.x, y, width: b.width, height: b.height });
  config.posY = y;
});
ipcMain.on("sidebar-move-end", () => saveConfig());
ipcMain.on("open-panel", openPanel);
ipcMain.on("panel-close", () => { if (panel) panel.hide(); });
ipcMain.on("refresh", tick);
ipcMain.on("quit", () => app.exit(0));
ipcMain.handle("get-config", () => config);
ipcMain.handle("get-usage", async () => await resolveUsage());
ipcMain.handle("get-version", () => app.getVersion());
ipcMain.handle("check-update", async () => await checkUpdate());
ipcMain.handle("set-config", (_e, patch) => {
  const before = { ...config };
  config = { ...config, ...(patch || {}) };
  saveConfig();
  if (patch && "autostart" in patch) applyAutostart();
  if (patch && "refreshMin" in patch) startTimer();
  if (patch && "showWidget" in patch && patch.showWidget !== before.showWidget) setWidgetVisible(patch.showWidget);
  rebuildTray();
  tick();
  return config;
});

// ----- ciclo de vida -----
const lock = app.requestSingleInstanceLock();
if (!lock) { app.quit(); }
else {
  app.on("second-instance", openPanel);
  app.whenReady().then(() => {
    loadConfig();
    applyAutostart();
    createSidebar();
    createTray();
    startTimer();
  });
  app.on("window-all-closed", () => { /* mantém vivo na bandeja */ });
}

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { readUsage } = require("./usage");
const live = require("./live");
const agentePipe = require("./agent-pipe");
const { criarAgregador } = require("./agent-state");
const hooksInstall = require("./hooks-install");
const { gerarPng } = require("./make-icon");

// Repositório para a verificação de atualizações (preenchido após a publicação).
const REPO = "Soturnna/token-usage-sidebar";
const APP_NAME = "Token Usage Sidebar";

// A janela da barra tem tamanho FIXO: largura do painel aberto + pílula, e
// altura da pílula (400) + folga para os balões dos gatos. Abrir/fechar o painel
// é só CSS; as áreas transparentes deixam o clique passar para o que está atrás
// (setIgnoreMouseEvents com encaminhamento). Antes, a janela era redimensionada
// de 94 para 424 px a cada hover e o Windows desenhava um quadro "torto" no meio.
const JANELA = { w: 424, h: 456 };
const MARGIN = 0;
const DEFAULTS = { refreshMin: 5, autostart: false, showWidget: true, primary: "7d", posY: null, cats: 1 };

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

// Encostada na borda direita da área útil (workArea respeita a barra de tarefas
// em qualquer lado da tela). posY é relativo ao topo da área útil.
function limitesSidebar() {
  const area = screen.getPrimaryDisplay().workArea;
  const x = area.x + area.width - JANELA.w - MARGIN;
  let y = config.posY != null ? config.posY : Math.round((area.height - JANELA.h) / 2);
  y = Math.max(0, Math.min(area.height - JANELA.h, y));
  return { x, y: area.y + y, width: JANELA.w, height: JANELA.h, relY: y };
}
function placeSidebar() {
  if (!sidebar || sidebar.isDestroyed()) return;
  const { relY, ...b } = limitesSidebar();
  sidebar.setBounds(b);
}

let sidebarInterativa = null;
// true = a janela recebe o mouse; false = cliques atravessam (só o movimento
// continua chegando ao renderer, para ele saber quando o cursor entra na barra)
function definirInterativa(v) {
  if (!sidebar || sidebar.isDestroyed() || v === sidebarInterativa) return;
  sidebarInterativa = v;
  sidebar.setIgnoreMouseEvents(!v, { forward: true });
}

function createSidebar() {
  sidebar = new BrowserWindow({
    ...limitesSidebar(),
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    fullscreenable: false, maximizable: false, minimizable: false,
    show: !!config.showWidget,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  sidebar.setAlwaysOnTop(true, "screen-saver");
  definirInterativa(false);
  sidebar.loadFile(path.join(__dirname, "renderer", "index.html"));
  placeSidebar();
  sidebar.webContents.on("did-finish-load", () => { tick(); enviarConfig(); enviarAgente(); });
  // Monitor trocado, resolução ou barra de tarefas alteradas: reposiciona
  for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) screen.on(ev, placeSidebar);
}

function enviarConfig() {
  for (const w of [sidebar, panel]) if (w && !w.isDestroyed()) w.webContents.send("config", config);
}

// ----- Estado do Claude Code (alimenta os gatos), via HOOKS -----
// Antes: fs.watch nas transcrições .jsonl + "6 s de silêncio = terminou". Isso
// falhava porque o .jsonl só é gravado quando uma mensagem TERMINA (17% das
// pausas reais dentro de um turno passavam de 6 s). Agora o próprio Claude Code
// avisa cada etapa pelos hooks: hook -> tus-relay.exe -> named pipe -> aqui.
const agregador = criarAgregador();
let relayInfo = null;           // { ok, exe, pipe, token } — ver agent-pipe.js
let pipeEscutando = false;
let pipeErro = null;
let ultimoStatusLine = null;    // { fh, sd, reset5h, reset7d, t } vindo da statusLine
let iconeNormal = null, iconeAlerta = null;

// Textos do estado (bandeja e painel)
const TEXTO_ESTADO = {
  idle: "Claude Code ocioso",
  thinking: "Pensando…",
  working: "Trabalhando",
  approval: "Aguardando sua aprovação",
  question: "Esperando sua resposta",
  finished: "Concluído",
  error: "Erro na resposta",
  ratelimit: "Limite de uso atingido",
};

function enviarAgente() {
  const resumo = { ...agregador.resumo(), conectado: pipeEscutando && integracao.hooks };
  for (const w of [sidebar, panel]) if (w && !w.isDestroyed()) w.webContents.send("agent", resumo);
  atualizarBandeja(resumo);
}

// Bandeja: o tooltip diz o estado; aguardando aprovação, o ícone ganha um selo
function atualizarBandeja(resumo) {
  if (!tray) return;
  const s = resumo.sessoes[0];
  let texto = TEXTO_ESTADO[resumo.estado] || "";
  if (s && s.tool && (resumo.estado === "working" || resumo.estado === "approval")) texto += " · " + s.tool;
  if (s && s.project) texto += " · " + s.project;
  tray.setToolTip(APP_NAME + "\n" + texto);
  const alerta = resumo.estado === "approval" || resumo.estado === "question";
  if (!iconeNormal) iconeNormal = nativeImage.createFromPath(ICON);
  if (!iconeAlerta) iconeAlerta = nativeImage.createFromBuffer(gerarPng({ alerta: true }));
  tray.setImage(alerta ? iconeAlerta : iconeNormal);
}

// Uma mensagem do relay: evento de hook ou limites da statusLine
function receberDoRelay(msg) {
  if (msg.kind === "statusline") return receberStatusLine(msg.rate_limits);
  if (agregador.aplicar(msg, Date.now())) enviarAgente();
}

function iniciarAgente() {
  // Em desenvolvimento o relay fica em assets/relay; no .exe, dentro do app.asar
  relayInfo = agentePipe.prepararRelay(path.join(__dirname, "..", "assets", "relay", "tus-relay.exe"));
  const servidor = agentePipe.iniciarServidor({
    pipe: relayInfo.pipe,
    token: relayInfo.token,
    aoReceber: receberDoRelay,
    aoErro: (e) => { pipeEscutando = false; pipeErro = String((e && e.code) || e); enviarAgente(); },
  });
  servidor.on("listening", () => { pipeEscutando = true; pipeErro = null; enviarAgente(); });
  // Transições por tempo (concluído -> ocioso, vigia...)
  setInterval(() => { if (agregador.tick(Date.now())) enviarAgente(); }, 1000);
  // O settings.json pode ser editado por fora: relê o estado da integração de vez em quando
  setInterval(() => {
    const antes = JSON.stringify(integracao);
    lerIntegracao();
    if (JSON.stringify(integracao) !== antes) { enviarAgente(); enviarIntegracao(); }
  }, 10000);
}

// ----- Integração com o Claude Code (painel de controle) -----
let integracao = { hooks: false, hooksParcial: false, statusLine: false, erro: null };
function lerIntegracao() {
  try { integracao = { ...hooksInstall.estado(hooksInstall.ler(hooksInstall.caminhoSettings()).obj), erro: null }; }
  catch (e) { integracao = { hooks: false, hooksParcial: false, statusLine: false, erro: String(e.message || e) }; }
  return integracao;
}
function statusIntegracao() {
  return {
    ...integracao,
    pipe: pipeEscutando, pipeErro,
    relay: !!(relayInfo && relayInfo.ok),
    settings: hooksInstall.caminhoSettings(),
  };
}
function enviarIntegracao() {
  if (panel && !panel.isDestroyed()) panel.webContents.send("integration", statusIntegracao());
}

// Cada ação vira uma transformação do settings.json (alvo: hooks | statusline)
function transformacao(alvo, acao) {
  const exe = relayInfo && relayInfo.exe;
  if (alvo === "hooks") return acao === "instalar" ? (o) => hooksInstall.comHooks(o, exe) : hooksInstall.semHooks;
  if (alvo === "statusline") {
    if (acao === "instalar") return (o) => hooksInstall.comStatus(o, exe).obj;
    const original = agentePipe.lerConfigRelay().statusLineOriginal || null;
    return (o) => hooksInstall.semStatus(o, original);
  }
  throw new Error("ação desconhecida");
}

// ----- Posição do cursor (caça ao mouse e olhar dos gatos) -----
// A janela da barra é estreita: o renderer não recebe eventos de mouse fora
// dela. Então o processo principal consulta a posição GLOBAL do cursor e a
// envia (coordenadas de tela, em DIP) só quando ela muda. A frequência é pedida
// pelo renderer: ~30 Hz com algum gato acordado (o olhar acompanha a cada
// quadro), 10 Hz com todos dormindo.
let cursorIntervaloMs = 100;
let cursorTimer = null;
let ultimoCursor = null;
function observarCursor() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    // Roda mesmo sem gatos: o renderer também usa o cursor para fechar o painel
    // quando o mouse sai da janela (com cliques atravessando, o "mouseleave" não é confiável)
    if (!sidebar || sidebar.isDestroyed() || !sidebar.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (ultimoCursor && ultimoCursor.x === p.x && ultimoCursor.y === p.y) return;
    ultimoCursor = p;
    sidebar.webContents.send("cursor", p);
  }, cursorIntervaloMs);
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

// ----- Uso (gauges 5h / 7d) -----
// Três fontes, da mais fresca para a de reserva:
//   1. statusLine do Claude Code (empurrada a cada resposta, sem rede) — opcional;
//   2. endpoint OAuth (live.js), consultado no intervalo configurado;
//   3. histórico local do app de desktop (usage.js).
// Entre 1 e 2 vence a leitura MAIS RECENTE: a statusLine só flui com uma sessão
// do Claude Code aberta, e o consumo pelo app/web só aparece no endpoint.
let liveFalhou = null;

const isoDeEpoch = (s) => (Number.isFinite(Number(s)) && Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);
function pctValido(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

// Limites recebidos da statusLine (formato da doc: used_percentage 0–100, resets_at em epoch s)
function receberStatusLine(rl) {
  if (!rl || typeof rl !== "object") return;
  const ant = ultimoStatusLine || {};
  const janela = (j, pctAnt, resetAnt) => (j && typeof j === "object"
    ? { pct: pctValido(j.used_percentage), reset: isoDeEpoch(j.resets_at) }
    : { pct: pctAnt ?? null, reset: resetAnt ?? null });    // janela ausente: mantém a última
  const f = janela(rl.five_hour, ant.fh, ant.reset5h);
  const s = janela(rl.seven_day, ant.sd, ant.reset7d);
  if (f.pct == null && s.pct == null) return;
  ultimoStatusLine = { fh: f.pct, sd: s.pct, reset5h: f.reset, reset7d: s.reset, status: null, t: Date.now() };
  enviarUso();   // atualiza na hora, sem consultar a rede
}

// Janela cuja hora de renovação já passou conta 0% até a próxima leitura
function statusLineAtual() {
  if (!ultimoStatusLine) return null;
  const agora = Date.now();
  const zerar = (pct, reset) => (reset && Date.parse(reset) <= agora ? 0 : pct);
  const u = ultimoStatusLine;
  return { ...u, fh: zerar(u.fh, u.reset5h), sd: zerar(u.sd, u.reset7d) };
}

async function resolveUsage({ rede = true } = {}) {
  const hist = readUsage();
  const extra = hist.ok
    ? { samples: hist.samples, peakSd: hist.peakSd, peakFh: hist.peakFh, count: hist.count, daysActive: hist.daysActive, org: hist.org }
    : { samples: [], peakSd: null, peakFh: null, count: null, daysActive: null, org: null };
  if (rede) {
    const l = await live.getLive();
    if (l.ok) { lastLive = { fh: l.fh, sd: l.sd, reset5h: l.reset5h, reset7d: l.reset7d, status: l.status, t: l.t }; liveFalhou = null; }
    else liveFalhou = l.error || "erro";
  }
  const sl = statusLineAtual();
  const melhor = [sl, lastLive].filter(Boolean).sort((a, b) => b.t - a.t)[0];
  if (melhor === sl && sl) return { ok: true, source: "claude-code", ...sl, ...extra };
  if (lastLive) return { ok: true, source: "live", ...(liveFalhou ? { stale: true } : {}), ...lastLive, ...extra };
  if (hist.ok) return { ...hist, source: "local", liveError: liveFalhou };
  return { ok: false, error: hist.error || liveFalhou || "sem-dados", liveError: liveFalhou };
}

function enviarDadosUso(data) {
  for (const w of [sidebar, panel]) {
    if (w && !w.isDestroyed()) w.webContents.send("usage", data);
  }
}
async function tick() { enviarDadosUso(await resolveUsage()); }
async function enviarUso() { enviarDadosUso(await resolveUsage({ rede: false })); }
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

// ----- Abrir o Claude (desktop / web / terminal) -----
const CLAUDE_WEB = "https://claude.ai";

// App de desktop: usa o protocolo claude:// registrado pelo instalador (funciona
// em instalação pela Microsoft Store ou pelo instalador comum). Sem protocolo, abre a web.
function openClaudeDesktop() {
  let handler = "";
  try { handler = app.getApplicationNameForProtocol("claude://"); } catch { /* ignora */ }
  shell.openExternal(handler ? "claude://" : CLAUDE_WEB).catch(() => shell.openExternal(CLAUDE_WEB));
}

function openClaudeWeb() {
  shell.openExternal(CLAUDE_WEB);
}

// Claude Code: abre o Windows Terminal já rodando `claude` na pasta do usuário.
// Se o Windows Terminal não existir, recorre a uma janela do cmd.
function openClaudeCode() {
  const home = os.homedir();
  const viaCmd = () => {
    try {
      spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", "claude"], { cwd: home, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch { /* ignora */ }
  };
  try {
    const wt = spawn("wt.exe", ["-d", home, "cmd", "/k", "claude"], { cwd: home, detached: true, stdio: "ignore" });
    wt.on("error", viaCmd);
    wt.unref();
  } catch { viaCmd(); }
}

function claudeMenuItems() {
  return [
    { label: "App de desktop do Claude", click: openClaudeDesktop },
    { label: "claude.ai no navegador", click: openClaudeWeb },
    { label: "Claude Code (terminal)", click: openClaudeCode },
  ];
}

function rebuildTray() {
  if (!tray) return;
  const freqs = [1, 5, 15, 60];
  const menu = Menu.buildFromTemplate([
    { label: "Abrir Claude", submenu: claudeMenuItems() },
    { type: "separator" },
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
ipcMain.on("set-interactive", (_e, v) => definirInterativa(!!v));
ipcMain.on("sidebar-move", (_e, screenY, grabY) => {
  if (!sidebar) return;
  const area = screen.getPrimaryDisplay().workArea;
  let y = Math.round(Number(screenY) - Number(grabY)) - area.y;
  y = Math.max(0, Math.min(area.height - JANELA.h, y));
  config.posY = y;
  placeSidebar();
});
ipcMain.on("sidebar-move-end", () => saveConfig());
ipcMain.on("open-panel", openPanel);
ipcMain.on("open-claude-menu", () => {
  Menu.buildFromTemplate(claudeMenuItems()).popup({ window: sidebar || undefined });
});
ipcMain.on("panel-close", () => { if (panel) panel.hide(); });
ipcMain.on("refresh", tick);
ipcMain.on("quit", () => app.exit(0));
// O renderer pede mais ou menos amostras do cursor (gato acordado / dormindo)
ipcMain.on("cursor-hz", (_e, hz) => {
  const ms = Math.max(30, Math.min(200, Math.round(1000 / (Number(hz) || 10))));
  if (ms !== cursorIntervaloMs) { cursorIntervaloMs = ms; observarCursor(); }
});
ipcMain.handle("get-agent", () => ({ ...agregador.resumo(), conectado: pipeEscutando && integracao.hooks }));

// Integração: status -> prévia (diff) -> aplicar. Só grava o que foi mostrado:
// a prévia fica guardada aqui e a gravação confere a impressão digital do arquivo.
let ultimaPrevia = null;
ipcMain.handle("integration-status", () => { lerIntegracao(); return statusIntegracao(); });
ipcMain.handle("integration-preview", (_e, pedido) => {
  try {
    const { alvo, acao } = pedido || {};
    if (acao === "instalar" && !(relayInfo && relayInfo.ok)) throw new Error("o relay não está disponível nesta instalação");
    const p = hooksInstall.previa(hooksInstall.caminhoSettings(), transformacao(alvo, acao));
    ultimaPrevia = { alvo, acao, ...p };
    return { ok: true, diff: p.diff, mudou: p.mudou, impressao: p.impressao, settings: hooksInstall.caminhoSettings() };
  } catch (e) { return { ok: false, erro: String(e.message || e) }; }
});
ipcMain.handle("integration-apply", (_e, pedido) => {
  try {
    const { alvo, acao, impressao } = pedido || {};
    const p = ultimaPrevia;
    if (!p || p.alvo !== alvo || p.acao !== acao || p.impressao !== impressao) throw new Error("abra a prévia de novo antes de aplicar");
    const arq = hooksInstall.caminhoSettings();
    // statusLine: guarda a original para o relay repassar a saída dela e para restaurar depois
    if (alvo === "statusline" && acao === "instalar") {
      const { original } = hooksInstall.comStatus(hooksInstall.ler(arq).obj, relayInfo.exe);
      agentePipe.atualizarConfigRelay({
        statusLineOriginal: original,
        statusLineAnterior: original && typeof original.command === "string" ? original.command : null,
      });
    }
    const { backup } = hooksInstall.gravar(arq, p.novo, impressao);
    if (alvo === "statusline" && acao === "remover") agentePipe.atualizarConfigRelay({ statusLineOriginal: null, statusLineAnterior: null });
    ultimaPrevia = null;
    lerIntegracao();
    enviarAgente();
    return { ok: true, backup, status: statusIntegracao() };
  } catch (e) { return { ok: false, erro: String(e.message || e) }; }
});

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
  enviarConfig();
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
    lerIntegracao();
    createSidebar();
    createTray();
    startTimer();
    iniciarAgente();
    observarCursor();
  });
  app.on("window-all-closed", () => { /* mantém vivo na bandeja */ });
}

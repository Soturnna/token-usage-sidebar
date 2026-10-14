const app = document.getElementById("app");
const pill = document.getElementById("pill");
const badgeEl = document.getElementById("source-badge");
const updatedEl = document.getElementById("updated");
const sPeak = document.getElementById("s-peak");
const sDays = document.getElementById("s-days");

// ----- Hover: abrir / fechar o painel -----
// A janela tem tamanho fixo; fora da pílula, do painel aberto e dos gatos ela
// deixa os cliques atravessarem para o que está atrás (o movimento do mouse
// continua chegando aqui, encaminhado). Abrir/fechar é só uma classe CSS.
//   intenção de abrir: 90 ms parado sobre a pílula (passar de raspão não abre)
//   tolerância para fechar: 260 ms (atravessar o vão entre pílula e painel não fecha)
const panelEl = document.getElementById("panel");
const T_ABRIR = 90, T_FECHAR = 260;
let tAbrir = null, tFechar = null, interativo = null;

function definirInterativo(v) {
  if (v === interativo) return;
  interativo = v;
  window.sidebar.setInteractive(v);
}
function abrir() {
  clearTimeout(tFechar); tFechar = null;
  if (!app.classList.contains("collapsed") || tAbrir) return;
  tAbrir = setTimeout(() => {
    tAbrir = null;
    app.classList.remove("collapsed");
    panelEl.setAttribute("aria-hidden", "false");
  }, T_ABRIR);
}
function fechar() {
  clearTimeout(tAbrir); tAbrir = null;
  if (app.classList.contains("collapsed") || tFechar) return;
  tFechar = setTimeout(() => {
    tFechar = null;
    app.classList.add("collapsed");
    panelEl.setAttribute("aria-hidden", "true");
  }, T_FECHAR);
}
// O que está sob o ponto (x, y) da janela? (o painel fechado tem
// pointer-events:none, então não conta)
function avaliarPonto(x, y) {
  const el = document.elementFromPoint(x, y);
  const naBarra = !!(el && el.closest("#pill, #panel"));
  definirInterativo(_drag || naBarra || !!(el && el.closest(".cat-hit")));
  if (_drag) return;
  if (naBarra && (el.closest("#pill") || !app.classList.contains("collapsed"))) abrir();
  else fechar();
}
document.addEventListener("mousemove", (e) => avaliarPonto(e.clientX, e.clientY));
document.addEventListener("mouseleave", () => { if (!_drag) { definirInterativo(false); fechar(); } });
// Rede de segurança: o cursor global (main, ~10–30 Hz) fora da janela fecha o painel
function cursorGlobal(p) {
  const x = p.x - window.screenX, y = p.y - window.screenY;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { if (!_drag) { definirInterativo(false); fechar(); } }
}

// botões
document.getElementById("gear").addEventListener("click", () => window.sidebar.openPanel());
document.getElementById("refresh-w").addEventListener("click", () => window.sidebar.refresh());
document.getElementById("btn-quit").addEventListener("click", () => window.sidebar.quit());

// botão "Abrir Claude": impede que o clique inicie o arraste da pílula
const launchBtn = document.getElementById("launch");
launchBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
launchBtn.addEventListener("click", (e) => { e.stopPropagation(); window.sidebar.openClaudeMenu(); });

// arrastar a barra verticalmente (segurando em qualquer parte da pílula)
let _drag = false, _grabY = 0, _moved = false;
pill.addEventListener("pointerdown", (e) => { _drag = true; _moved = false; _grabY = e.clientY; try { pill.setPointerCapture(e.pointerId); } catch {} });
pill.addEventListener("pointermove", (e) => { if (!_drag) return; if (Math.abs(e.clientY - _grabY) > 3) _moved = true; window.sidebar.move(e.screenY, _grabY); });
pill.addEventListener("pointerup", (e) => { if (!_drag) return; _drag = false; window.sidebar.moveEnd(); avaliarPonto(e.clientX, e.clientY); });

// utilidades de tempo
function since(ms) {
  if (!ms) return "—";
  let s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "há " + s + "s";
  if (s < 3600) return "há " + Math.round(s / 60) + "min";
  if (s < 86400) return "há " + Math.round(s / 3600) + "h";
  return "há " + Math.round(s / 86400) + "d";
}
function parseDate(iso) { if (!iso) return null; const t = Date.parse(iso); return Number.isNaN(t) ? null : new Date(t); }
function resetRel(iso) {
  const d = parseDate(iso); if (!d) return "";
  let s = Math.max(0, Math.round((d.getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h >= 24) return "renova em " + Math.floor(h / 24) + "d " + (h % 24) + "h";
  return "renova em " + h + "h " + m + "m";
}
function resetAbs(iso) {
  const d = parseDate(iso); if (!d) return "";
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  return "renova " + dias[d.getDay()] + " " + hh + ":" + mm;
}

// medidores da pílula
function setGauge(key, util) {
  const g = pill.querySelector('.gauge[data-key="' + key + '"]');
  const ring = g.querySelector(".ring"), val = g.querySelector(".val");
  const c = key === "5h" ? "var(--green)" : "var(--bronze)";
  ring.style.setProperty("--p", util == null ? 0 : Math.max(0, Math.min(100, util)));
  ring.style.setProperty("--c", util == null ? "var(--muted)" : c);
  val.textContent = util == null ? "–" : Math.round(util) + "%";
  // A roda é um desenho: o leitor de tela recebe o valor por extenso
  const nome = key === "5h" ? "Janela de 5 horas" : "Janela de 7 dias";
  g.setAttribute("aria-label", nome + ": " + (util == null ? "sem dados" : Math.round(util) + "% usado"));
}
// linhas do painel
function setRow(key, pct, resetText) {
  document.getElementById("v-" + key).textContent = pct == null ? "–" : Math.round(pct) + "%";
  document.getElementById("bar-" + key).style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + "%";
  document.getElementById("reset-" + key).textContent = resetText || "";
}

function apply(d) {
  const ok = d && d.ok;
  const isLive = ok && (d.source === "live" || d.source === "claude-code");
  // "Claude Code" = números vindos da statusLine (empurrados a cada resposta)
  badgeEl.textContent = !ok ? "—" : d.source === "claude-code" ? "Claude Code" : (isLive ? "ao vivo" : "local");
  badgeEl.classList.toggle("local", ok && !isLive);
  if (!ok) {
    setGauge("5h", null); setGauge("7d", null);
    setRow("5h", null, ""); setRow("7d", null, "");
    sPeak.textContent = "–"; sDays.textContent = "–";
    updatedEl.textContent = d && d.error === "no-file" ? "Claude não encontrado" : "sem dados";
    return;
  }
  setGauge("5h", d.fh); setGauge("7d", d.sd);
  setRow("5h", d.fh, resetRel(d.reset5h));
  setRow("7d", d.sd, resetAbs(d.reset7d));
  sPeak.textContent = d.peakSd == null ? "–" : Math.round(d.peakSd) + "%";
  sDays.textContent = d.daysActive ?? "–";
  updatedEl.textContent = "atualizado " + since(d.t);
}

window.sidebar.onUsage(apply);

// ----- Estado do Claude Code (linha no painel de hover) -----
const agentRow = document.getElementById("agent-row");
const agentText = document.getElementById("agent-text");
const TEXTO_AGENTE = {
  idle: "Claude Code ocioso",
  thinking: "Pensando…",
  working: "Trabalhando",
  approval: "Aguardando sua aprovação",
  question: "Esperando sua resposta",
  finished: "Concluído",
  error: "Erro na resposta",
  ratelimit: "Limite de uso atingido",
};
function mostrarAgente(r) {
  if (!r) return;
  if (!r.conectado) {
    agentRow.dataset.estado = "offline";
    agentText.textContent = "Gatos sem conexão com o Claude Code: conecte no painel de controle";
    return;
  }
  const s = r.sessoes && r.sessoes[0];
  let texto = TEXTO_AGENTE[r.estado] || TEXTO_AGENTE.idle;
  if (s && s.tool && (r.estado === "working" || r.estado === "approval")) texto += " · " + s.tool;
  if (s && s.project) texto += " · " + s.project;
  if (r.sessoes && r.sessoes.length > 1) texto += " (+" + (r.sessoes.length - 1) + ")";
  agentRow.dataset.estado = r.estado;
  // Só reescreve se mudou: o aria-live anunciaria a mesma frase de novo
  if (agentText.textContent !== texto) agentText.textContent = texto;
}

// ----- Pets virtuais (gatinhos) -----
CatPets.init(document.getElementById("cats"), { pedirFrequencia: (hz) => window.sidebar.cursorHz(hz) });
window.sidebar.onConfig((cfg) => CatPets.setCount(cfg && cfg.cats));
window.sidebar.onAgent((r) => { CatPets.setAgente(r); mostrarAgente(r); });
window.sidebar.getAgent().then((r) => { CatPets.setAgente(r); mostrarAgente(r); });
window.sidebar.onCursor((p) => { CatPets.setCursor(p); cursorGlobal(p); });

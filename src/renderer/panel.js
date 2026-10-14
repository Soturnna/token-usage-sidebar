const $ = (id) => document.getElementById(id);

function colorFor(p) {
  if (p == null) return "var(--muted)";
  if (p >= 90) return "var(--red)";
  if (p >= 70) return "var(--amber)";
  return "var(--accent)";
}
function fmtSince(ms) {
  if (!ms) return "—";
  let s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "há " + s + "s";
  if (s < 3600) return "há " + Math.round(s / 60) + "min";
  if (s < 86400) return "há " + Math.round(s / 3600) + "h";
  return "há " + Math.round(s / 86400) + "d";
}
function tile(id, bid, p) {
  const el = $(id), bar = $(bid);
  if (p == null) { el.textContent = "–"; el.style.color = "var(--muted)"; bar.style.width = "0"; return; }
  el.textContent = p.toFixed(0) + "%";
  el.style.color = colorFor(p);
  bar.style.width = Math.max(0, Math.min(100, p)) + "%";
  bar.style.background = colorFor(p);
}
function sub(k, v) { return `<div class="s">${k}<b>${v}</b></div>`; }

function renderStatus(d) {
  const badge = $("source-badge");
  if (!d || !d.ok) {
    tile("t-7d", "b-7d", null); tile("t-5h", "b-5h", null);
    badge.textContent = "sem dados"; badge.className = "badge local";
    $("substats").innerHTML = "";
    return;
  }
  tile("t-7d", "b-7d", d.sd);
  tile("t-5h", "b-5h", d.fh);
  const live = d.source === "live" || d.source === "claude-code";
  badge.textContent = d.source === "claude-code" ? "Claude Code" : live ? "ao vivo" : "local";
  badge.className = "badge" + (live ? "" : " local");
  const pf = (n) => (n == null ? "–" : n.toFixed(0) + "%");
  $("substats").innerHTML =
    sub("Pico 7 dias", pf(d.peakSd)) + sub("Pico 5 horas", pf(d.peakFh)) +
    sub("Dias ativos", d.daysActive ?? "–") + sub("Amostras", d.count ?? "–") +
    sub("Atualizado", fmtSince(d.t)) + sub("Organização", d.org ? d.org.slice(0, 8) + "…" : "–");
}

async function init() {
  const cfg = await window.panelApi.getConfig();
  $("showWidget").checked = !!cfg.showWidget;
  $("autostart").checked = !!cfg.autostart;
  $("refreshMin").value = String(cfg.refreshMin || 5);
  $("cats").value = String(cfg.cats == null ? 1 : cfg.cats);
  $("version").textContent = "v" + (await window.panelApi.getVersion());
  renderStatus(await window.panelApi.getUsage());
}

$("showWidget").addEventListener("change", (e) => window.panelApi.setConfig({ showWidget: e.target.checked }));
$("autostart").addEventListener("change", (e) => window.panelApi.setConfig({ autostart: e.target.checked }));
$("refreshMin").addEventListener("change", (e) => window.panelApi.setConfig({ refreshMin: Number(e.target.value) }));
$("cats").addEventListener("change", (e) => window.panelApi.setConfig({ cats: Number(e.target.value) }));
$("refresh").addEventListener("click", () => window.panelApi.refresh());
$("quit").addEventListener("click", () => window.panelApi.quit());
$("close").addEventListener("click", () => window.panelApi.close());

$("check-update").addEventListener("click", async () => {
  const el = $("update-status");
  el.textContent = "verificando…";
  const r = await window.panelApi.checkUpdate();
  if (!r || !r.ok) {
    el.textContent =
      r && r.error === "no-repo" ? "repositório não configurado" :
      r && r.error === "none" ? "nenhuma release encontrada" :
      "não foi possível verificar";
    return;
  }
  el.textContent = r.newer ? `nova versão: v${r.latest}` : "você está atualizado";
  el.style.color = r.newer ? "var(--amber)" : "var(--accent)";
});

// ----- Integração com o Claude Code -----
// Fluxo: botão -> prévia (diff do settings.json) -> "Aplicar". Nada é gravado
// sem o clique em "Aplicar"; antes de gravar, o app faz um backup datado.
let integ = null;          // último status recebido do main
let previaAtual = null;    // { alvo, acao, impressao }

function renderIntegracao(s) {
  if (!s) return;
  integ = s;
  const badge = $("integ-badge"), txt = $("integ-txt");
  if (s.erro) {
    badge.textContent = "erro"; badge.className = "badge local";
    txt.textContent = "Não consegui ler o settings.json: " + s.erro;
  } else if (!s.relay) {
    badge.textContent = "indisponível"; badge.className = "badge local";
    txt.textContent = "O relay dos hooks não veio nesta versão do app.";
  } else if (!s.pipe) {
    badge.textContent = "sem escuta"; badge.className = "badge local";
    txt.textContent = "O canal de eventos não abriu" + (s.pipeErro ? " (" + s.pipeErro + ")" : "") + ". Feche outras cópias do app e reabra.";
  } else if (s.hooks) {
    badge.textContent = "conectado"; badge.className = "badge";
    txt.textContent = "Os gatos recebem os eventos do Claude Code em tempo real. Sessões já abertas passam a enviar eventos ao serem reiniciadas.";
  } else {
    badge.textContent = s.hooksParcial ? "incompleto" : "desconectado"; badge.className = "badge local";
    txt.textContent = "Conecte para os gatos saberem quando o Claude pensa, trabalha, termina ou espera sua aprovação.";
  }
  $("hooks-btn").textContent = s.hooks ? "Desconectar" : "Conectar";
  $("status-btn").textContent = s.statusLine ? "Desativar" : "Ativar";
  const bloqueado = !!s.erro || !s.relay;
  $("hooks-btn").disabled = bloqueado;
  $("status-btn").disabled = bloqueado;
}

// Pinta o diff: linhas "+ " em verde, "- " em vermelho (texto seguro, sem innerHTML)
function mostrarDiff(texto) {
  const pre = $("diff");
  pre.textContent = "";
  for (const linha of texto.split("\n")) {
    const span = document.createElement("span");
    if (linha.startsWith("+ ")) span.className = "add";
    else if (linha.startsWith("- ")) span.className = "del";
    span.textContent = linha + "\n";
    pre.appendChild(span);
  }
}

async function pedirPrevia(alvo, acao) {
  $("integ-msg").textContent = "";
  const r = await window.panelApi.integrationPreview(alvo, acao);
  if (!r || !r.ok) { $("integ-msg").textContent = "Não foi possível preparar a alteração: " + ((r && r.erro) || "erro"); return; }
  if (!r.mudou) { $("integ-msg").textContent = "Nada a alterar: o settings.json já está assim."; return; }
  previaAtual = { alvo, acao, impressao: r.impressao };
  $("diff-title").textContent = (acao === "instalar" ? "Vai adicionar a " : "Vai remover de ") + r.settings + ":";
  mostrarDiff(r.diff);
  $("diff-note").textContent = "Um backup (settings.json.bak-AAAAMMDD-HHMMSS) é criado antes de gravar. Hooks de outras ferramentas não são tocados.";
  $("diff-box").hidden = false;
  $("diff-apply").focus();
}

function fecharPrevia() { previaAtual = null; $("diff-box").hidden = true; }

$("hooks-btn").addEventListener("click", () => pedirPrevia("hooks", integ && integ.hooks ? "remover" : "instalar"));
$("status-btn").addEventListener("click", () => pedirPrevia("statusline", integ && integ.statusLine ? "remover" : "instalar"));
$("diff-cancel").addEventListener("click", fecharPrevia);
$("diff-apply").addEventListener("click", async () => {
  if (!previaAtual) return;
  const { alvo, acao, impressao } = previaAtual;
  $("diff-apply").disabled = true;
  const r = await window.panelApi.integrationApply(alvo, acao, impressao);
  $("diff-apply").disabled = false;
  fecharPrevia();
  if (!r || !r.ok) { $("integ-msg").textContent = "Nada foi gravado: " + ((r && r.erro) || "erro"); return; }
  renderIntegracao(r.status);
  $("integ-msg").textContent = "Pronto." + (r.backup ? " Backup: " + r.backup : "");
});

window.panelApi.onIntegration(renderIntegracao);
window.panelApi.integrationStatus().then(renderIntegracao);

window.panelApi.onUsage(renderStatus);
init();

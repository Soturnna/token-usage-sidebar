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
  const live = d.source === "live";
  badge.textContent = live ? "ao vivo" : "local";
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
  $("version").textContent = "v" + (await window.panelApi.getVersion());
  renderStatus(await window.panelApi.getUsage());
}

$("showWidget").addEventListener("change", (e) => window.panelApi.setConfig({ showWidget: e.target.checked }));
$("autostart").addEventListener("change", (e) => window.panelApi.setConfig({ autostart: e.target.checked }));
$("refreshMin").addEventListener("change", (e) => window.panelApi.setConfig({ refreshMin: Number(e.target.value) }));
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

window.panelApi.onUsage(renderStatus);
init();

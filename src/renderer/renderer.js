const app = document.getElementById("app");
const pill = document.getElementById("pill");
const badgeEl = document.getElementById("source-badge");
const updatedEl = document.getElementById("updated");
const sPeak = document.getElementById("s-peak");
const sDays = document.getElementById("s-days");

// expandir / recolher ao passar o mouse
pill.addEventListener("mouseenter", () => { app.classList.remove("collapsed"); window.sidebar.expand(); });
app.addEventListener("mouseleave", () => { app.classList.add("collapsed"); window.sidebar.collapse(); });

// botões
document.getElementById("gear").addEventListener("click", () => window.sidebar.openPanel());
document.getElementById("refresh-w").addEventListener("click", () => window.sidebar.refresh());
document.getElementById("btn-quit").addEventListener("click", () => window.sidebar.quit());

// arrastar a barra verticalmente (segurando em qualquer parte da pílula)
let _drag = false, _grabY = 0, _moved = false;
pill.addEventListener("pointerdown", (e) => { _drag = true; _moved = false; _grabY = e.clientY; try { pill.setPointerCapture(e.pointerId); } catch {} });
pill.addEventListener("pointermove", (e) => { if (!_drag) return; if (Math.abs(e.clientY - _grabY) > 3) _moved = true; window.sidebar.move(e.screenY, _grabY); });
pill.addEventListener("pointerup", () => { if (!_drag) return; _drag = false; window.sidebar.moveEnd(); });

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
}
// linhas do painel
function setRow(key, pct, resetText) {
  document.getElementById("v-" + key).textContent = pct == null ? "–" : Math.round(pct) + "%";
  document.getElementById("bar-" + key).style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + "%";
  document.getElementById("reset-" + key).textContent = resetText || "";
}

function apply(d) {
  const ok = d && d.ok;
  const isLive = ok && d.source === "live";
  badgeEl.textContent = !ok ? "—" : (isLive ? "ao vivo" : "local");
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

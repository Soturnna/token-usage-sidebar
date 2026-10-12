// Leitura "ao vivo" do uso, via o token OAuth em TEXTO PURO escrito pela CLI do Claude Code.
// Adaptado (reescrito) do mecanismo do projeto MIT CodeZeno/Claude-Code-Usage-Monitor.
// NÃO descriptografa cofres de credenciais: lê apenas o arquivo .credentials.json em texto.
const fs = require("fs");
const path = require("path");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

// Usa a pilha de rede do Electron (net.fetch), que respeita o repositório de
// certificados do Windows e o proxy do sistema — essencial em redes corporativas
// com inspeção TLS. Cai no fetch padrão quando fora do Electron.
let _net = null;
try { _net = require("electron").net; } catch { /* fora do Electron */ }
const httpFetch = (url, opts) => (_net && _net.fetch ? _net.fetch(url, opts) : fetch(url, opts));

function tokenFilePaths() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const list = [];
  if (process.env.CLAUDE_CONFIG_DIR) list.push(path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  if (home) list.push(path.join(home, ".claude", ".credentials.json"));
  return list;
}

function readPlainToken() {
  for (const p of tokenFilePaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const o = JSON.parse(fs.readFileSync(p, "utf8")).claudeAiOauth;
      if (o && o.accessToken) return { accessToken: o.accessToken, expiresAt: o.expiresAt || null };
    } catch { /* tenta o próximo */ }
  }
  return null;
}

function isExpired(expiresAt) {
  return expiresAt ? Date.now() >= Number(expiresAt) : false;
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// O corpo traz five_hour / seven_day { utilization (0..100), resets_at }.
// Formatos mais novos podem trazer os valores em `limits[]` com kind session/weekly_all.
function pickFromLimits(limits, kind) {
  if (!Array.isArray(limits)) return null;
  for (const l of limits) {
    if (!l || typeof l !== "object") continue;
    const noScope = l.scope == null;
    if (noScope && l.kind === kind && (typeof l.utilization === "number" || l.usage)) {
      const u = typeof l.utilization === "number" ? l.utilization : (l.usage && l.usage.percentage);
      const r = l.resets_at || (l.usage && l.usage.resets_at) || null;
      return { util: num(u), reset: r };
    }
  }
  return null;
}

function parseBody(body) {
  const out = { fh: null, sd: null, reset5h: null, reset7d: null };
  if (!body || typeof body !== "object") return out;
  if (body.five_hour && typeof body.five_hour === "object") {
    out.fh = num(body.five_hour.utilization);
    out.reset5h = body.five_hour.resets_at || null;
  }
  if (body.seven_day && typeof body.seven_day === "object") {
    out.sd = num(body.seven_day.utilization);
    out.reset7d = body.seven_day.resets_at || null;
  }
  if (out.fh == null) { const s = pickFromLimits(body.limits, "session"); if (s) { out.fh = s.util; out.reset5h = out.reset5h || s.reset; } }
  if (out.sd == null) { const w = pickFromLimits(body.limits, "weekly_all"); if (w) { out.sd = w.util; out.reset7d = out.reset7d || w.reset; } }
  return out;
}

async function fetchLiveUsage(token) {
  const res = await httpFetch(USAGE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
  if (res.status === 429) return { ok: false, error: "rate-limited", httpStatus: 429 };
  let body = null;
  try { body = await res.json(); } catch { /* corpo inválido */ }
  const p = parseBody(body);
  if (p.fh == null && p.sd == null) return { ok: false, error: "no-usage", httpStatus: res.status };
  return { ok: true, source: "live", fh: p.fh, sd: p.sd, reset5h: p.reset5h, reset7d: p.reset7d, status: null, t: Date.now() };
}

async function getLive() {
  const cred = readPlainToken();
  if (!cred) return { ok: false, error: "no-token" };
  if (isExpired(cred.expiresAt)) return { ok: false, error: "expired" };
  try { return await fetchLiveUsage(cred.accessToken); }
  catch (e) {
    const cause = e && e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : "";
    return { ok: false, error: "network", detail: String((e && e.message) || e) + (cause ? " cause=" + cause : "") };
  }
}

module.exports = { getLive };

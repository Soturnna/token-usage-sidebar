// Leitor de dados: lê o histórico local do app de desktop do Claude.
// Fonte: %APPDATA%\Claude\plan-usage-history.json (fh = janela de 5h, sd = janela de 7 dias).
const fs = require("fs");
const path = require("path");
const os = require("os");

// Resolve o caminho do historico sem depender de variaveis de ambiente, que o
// lancador do executavel portatil pode nao repassar. os.homedir() usa a API do
// Windows e funciona mesmo com APPDATA/USERPROFILE vazios. Retorna o primeiro
// caminho candidato que existir.
function historyPath() {
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "Claude", "plan-usage-history.json"));
  const home = os.homedir();
  if (home) candidates.push(path.join(home, "AppData", "Roaming", "Claude", "plan-usage-history.json"));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* tenta o proximo */ } }
  return candidates[0] || path.join("Claude", "plan-usage-history.json");
}

function numOrNull(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function readUsage(maxSamples = 40) {
  try {
    const p = historyPath();
    if (!fs.existsSync(p)) return { ok: false, error: "no-file" };
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const raw = Array.isArray(j.samples) ? j.samples : [];
    const norm = raw
      .filter((s) => s && s.u)
      .map((s) => ({ t: s.t, org: s.org || null, fh: numOrNull(s.u.fh), sd: numOrNull(s.u.sd) }));
    if (norm.length === 0) return { ok: false, error: "no-samples" };
    const last = norm[norm.length - 1];
    const sdVals = norm.map((s) => s.sd).filter((n) => n != null);
    const fhVals = norm.map((s) => s.fh).filter((n) => n != null);
    const days = new Set(norm.map((s) => new Date(s.t).toISOString().slice(0, 10)));
    return {
      ok: true,
      fh: last.fh,
      sd: last.sd,
      t: last.t,
      org: last.org,
      peakSd: sdVals.length ? Math.max(...sdVals) : null,
      peakFh: fhVals.length ? Math.max(...fhVals) : null,
      count: norm.length,
      daysActive: days.size,
      samples: norm.slice(-maxSamples),
    };
  } catch (e) {
    return { ok: false, error: "parse", detail: String((e && e.message) || e) };
  }
}

module.exports = { readUsage, historyPath };

// Instala / remove os hooks do token-usage-sidebar no ~/.claude/settings.json.
//
// Procedimento obrigatório (a mesma que o Coucou documenta): ler o arquivo, mostrar
// o diff, e só gravar depois de um clique — com backup datado, fundindo as
// nossas entradas SEM tocar em hooks de outras ferramentas. Desinstalar remove
// só o que é nosso. As nossas entradas são reconhecidas pelo nome "tus-relay".
//
// Todas as funções recebem o caminho do settings.json: os testes usam uma cópia.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Eventos que alimentam o gato (ver src/agent-state.js)
const EVENTOS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure",
  "SubagentStart", "SubagentStop",
];
const MARCADOR = "tus-relay";
const TIMEOUT_S = 5;   // o relay sai sozinho bem antes disso; é só uma rede de segurança

function caminhoSettings() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

// Lê o settings.json. Arquivo ausente = objeto vazio. JSON inválido = erro
// (nunca "consertamos" o arquivo de ninguém).
function ler(arquivo) {
  let texto = null;
  try { texto = fs.readFileSync(arquivo, "utf8"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  if (texto == null || !texto.trim()) return { obj: {}, texto };
  const obj = JSON.parse(texto.replace(/^﻿/, ""));
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("settings.json não é um objeto JSON");
  return { obj, texto };
}

const impressao = (texto) => crypto.createHash("sha256").update(texto == null ? "" : texto).digest("hex");

function ehNossa(entrada) {
  return !!(entrada && Array.isArray(entrada.hooks) &&
    entrada.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(MARCADOR)));
}
const statusEhNossa = (sl) => !!(sl && typeof sl.command === "string" && sl.command.includes(MARCADOR));

// Forma "exec" (command + args): o Claude Code executa o .exe direto, sem abrir
// um shell (economiza ~70 ms por evento). Sem argumento, o relay já assume "hook".
function entradaHook(exe) {
  return { hooks: [{ type: "command", command: exe, args: ["hook"], timeout: TIMEOUT_S }] };
}

// statusLine é sempre uma linha de shell (Git Bash no Windows): barras normais e aspas
function comandoStatus(exe) {
  return '"' + exe.replace(/\\/g, "/") + '" statusline';
}

function validarHooks(obj) {
  if (obj.hooks !== undefined && (typeof obj.hooks !== "object" || obj.hooks === null || Array.isArray(obj.hooks)))
    throw new Error('"hooks" tem um formato inesperado; nada foi alterado');
  for (const ev of EVENTOS) {
    const lista = obj.hooks && obj.hooks[ev];
    if (lista !== undefined && !Array.isArray(lista))
      throw new Error(`"hooks.${ev}" tem um formato inesperado; nada foi alterado`);
  }
}

// Novo objeto com as nossas entradas (re)adicionadas; o resto fica idêntico
function comHooks(obj, exe) {
  validarHooks(obj);
  const novo = JSON.parse(JSON.stringify(obj));
  novo.hooks = novo.hooks || {};
  for (const ev of EVENTOS) {
    const lista = (novo.hooks[ev] || []).filter((e) => !ehNossa(e));
    lista.push(entradaHook(exe));
    novo.hooks[ev] = lista;
  }
  return novo;
}

// Novo objeto sem as nossas entradas (listas e "hooks" vazios somem)
function semHooks(obj) {
  const novo = JSON.parse(JSON.stringify(obj));
  if (!novo.hooks || typeof novo.hooks !== "object") return novo;
  for (const ev of Object.keys(novo.hooks)) {
    if (!Array.isArray(novo.hooks[ev])) continue;
    novo.hooks[ev] = novo.hooks[ev].filter((e) => !ehNossa(e));
    if (!novo.hooks[ev].length) delete novo.hooks[ev];
  }
  if (!Object.keys(novo.hooks).length) delete novo.hooks;
  return novo;
}

// statusLine: troca só o "command" (padding, refreshInterval... são mantidos).
// Retorna também a original, para o relay repassar a saída dela e para restaurar depois.
function comStatus(obj, exe) {
  const novo = JSON.parse(JSON.stringify(obj));
  const original = novo.statusLine && !statusEhNossa(novo.statusLine) ? novo.statusLine : null;
  novo.statusLine = { ...(original || {}), type: "command", command: comandoStatus(exe) };
  return { obj: novo, original };
}

function semStatus(obj, original) {
  const novo = JSON.parse(JSON.stringify(obj));
  if (!statusEhNossa(novo.statusLine)) return novo;   // o usuário trocou: não mexemos
  if (original) novo.statusLine = original; else delete novo.statusLine;
  return novo;
}

function estado(obj) {
  const instalados = EVENTOS.filter((ev) => Array.isArray(obj.hooks && obj.hooks[ev]) && obj.hooks[ev].some(ehNossa));
  return {
    hooks: instalados.length === EVENTOS.length,
    hooksParcial: instalados.length > 0 && instalados.length < EVENTOS.length,
    statusLine: statusEhNossa(obj.statusLine),
  };
}

// Diff de linhas (LCS) entre dois JSON formatados, com 2 linhas de contexto.
// O settings.json é pequeno, então o O(n·m) não pesa.
function diff(antes, depois) {
  const a = antes.split("\n"), b = depois.split("\n");
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(["  ", a[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push(["- ", a[i++]]);
    else ops.push(["+ ", b[j++]]);
  }
  while (i < n) ops.push(["- ", a[i++]]);
  while (j < m) ops.push(["+ ", b[j++]]);
  // Mostra só as mudanças e 2 linhas em volta
  const mostrar = ops.map(() => false);
  ops.forEach(([tipo], k) => { if (tipo !== "  ") for (let d = -2; d <= 2; d++) if (ops[k + d]) mostrar[k + d] = true; });
  const linhas = [];
  ops.forEach(([tipo, txt], k) => {
    if (mostrar[k]) linhas.push(tipo + txt);
    else if (k > 0 && mostrar[k - 1]) linhas.push("  …");
  });
  return linhas.join("\n");
}

const formatar = (obj) => JSON.stringify(obj, null, 2) + "\n";

// Prévia de uma alteração: diff + impressão digital do arquivo lido. A gravação
// só acontece se o arquivo ainda for EXATAMENTE o que o usuário viu.
function previa(arquivo, transformar) {
  const { obj, texto } = ler(arquivo);
  const novo = transformar(obj);
  const antes = texto == null ? "" : formatar(obj);
  const depois = formatar(novo);
  return { diff: diff(antes, depois), mudou: antes !== depois, impressao: impressao(texto), novo };
}

function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Grava com backup datado e de forma atômica (arquivo temporário + rename)
function gravar(arquivo, novo, impressaoEsperada) {
  const { texto } = ler(arquivo);
  if (impressao(texto) !== impressaoEsperada)
    throw new Error("o settings.json mudou desde a prévia; abra a prévia de novo");
  let backup = null;
  if (texto != null) {
    backup = `${arquivo}.bak-${carimbo()}`;
    fs.copyFileSync(arquivo, backup);
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + ".tus-tmp";
  fs.writeFileSync(tmp, formatar(novo));
  fs.renameSync(tmp, arquivo);
  return { backup };
}

module.exports = {
  EVENTOS, caminhoSettings, ler, estado, previa, gravar,
  comHooks, semHooks, comStatus, semStatus, diff, ehNossa,
};

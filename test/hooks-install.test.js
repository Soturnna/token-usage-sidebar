// Testes do instalador de hooks: sempre numa CÓPIA temporária, nunca no
// ~/.claude/settings.json de verdade. (node test/hooks-install.test.js)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const H = require("../src/hooks-install");

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log("ok   -", nome); }
  catch (e) { falhas++; console.log("FALHA -", nome, "\n      ", e.message); }
}
const EXE = "C:\\Users\\Fulano de Tal\\AppData\\Local\\token-usage-sidebar\\bin\\tus-relay.exe";
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "tus-teste-"));
const arq = path.join(pasta, "settings.json");
const escrever = (obj) => fs.writeFileSync(arq, JSON.stringify(obj, null, 2));

teste("funde sem apagar hooks de outras ferramentas", () => {
  const alheio = { hooks: [{ type: "command", command: "outra-ferramenta.exe" }] };
  escrever({ theme: "dark", hooks: { PreToolUse: [alheio] } });
  const p = H.previa(arq, (o) => H.comHooks(o, EXE));
  const { backup } = H.gravar(arq, p.novo, p.impressao);
  const depois = JSON.parse(fs.readFileSync(arq, "utf8"));
  assert.strictEqual(depois.theme, "dark");
  assert.deepStrictEqual(depois.hooks.PreToolUse[0], alheio);       // o alheio continua lá, em primeiro
  assert.ok(H.ehNossa(depois.hooks.PreToolUse[1]));
  for (const ev of H.EVENTOS) assert.ok(depois.hooks[ev].some(H.ehNossa), ev);
  assert.ok(backup && fs.existsSync(backup), "backup datado criado");
  assert.deepStrictEqual(H.estado(depois), { hooks: true, hooksParcial: false, statusLine: false });
});

teste("reinstalar não duplica", () => {
  const p = H.previa(arq, (o) => H.comHooks(o, EXE));
  assert.strictEqual(p.mudou, false);
  const o = H.comHooks(H.ler(arq).obj, EXE);
  assert.strictEqual(o.hooks.Stop.filter(H.ehNossa).length, 1);
});

teste("desinstalar remove só o que é nosso", () => {
  const p = H.previa(arq, H.semHooks);
  H.gravar(arq, p.novo, p.impressao);
  const depois = JSON.parse(fs.readFileSync(arq, "utf8"));
  assert.deepStrictEqual(Object.keys(depois.hooks), ["PreToolUse"]);
  assert.strictEqual(depois.hooks.PreToolUse.length, 1);
  assert.strictEqual(depois.theme, "dark");
});

teste("recusa gravar se o arquivo mudou depois da prévia", () => {
  const p = H.previa(arq, (o) => H.comHooks(o, EXE));
  escrever({ theme: "light" });
  assert.throws(() => H.gravar(arq, p.novo, p.impressao), /mudou/);
});

teste("formato inesperado não é tocado", () => {
  escrever({ hooks: { PreToolUse: { nao: "é lista" } } });
  assert.throws(() => H.previa(arq, (o) => H.comHooks(o, EXE)), /inesperado/);
});

teste("arquivo inexistente: cria sem backup", () => {
  fs.unlinkSync(arq);
  const p = H.previa(arq, (o) => H.comHooks(o, EXE));
  const { backup } = H.gravar(arq, p.novo, p.impressao);
  assert.strictEqual(backup, null);
  assert.ok(H.estado(H.ler(arq).obj).hooks);
});

teste("statusLine: guarda a anterior e restaura na remoção", () => {
  const antiga = { type: "command", command: "~/minha-barra.sh", padding: 1 };
  escrever({ statusLine: antiga });
  const { obj, original } = H.comStatus(H.ler(arq).obj, EXE);
  assert.deepStrictEqual(original, antiga);
  assert.strictEqual(obj.statusLine.padding, 1);                   // campos extras preservados
  assert.ok(obj.statusLine.command.includes("tus-relay") && obj.statusLine.command.includes("statusline"));
  assert.ok(obj.statusLine.command.startsWith('"C:/Users/Fulano de Tal/'));   // barras normais + aspas (espaço no caminho)
  assert.deepStrictEqual(H.semStatus(obj, original).statusLine, antiga);
  assert.strictEqual(H.semStatus(H.comStatus({}, EXE).obj, null).statusLine, undefined);
});

teste("statusLine trocada pelo usuário depois não é mexida", () => {
  const dele = { type: "command", command: "outra.sh" };
  assert.deepStrictEqual(H.semStatus({ statusLine: dele }, null).statusLine, dele);
});

teste("diff mostra só as linhas alteradas", () => {
  const d = H.diff('{\n  "a": 1\n}\n', '{\n  "a": 1,\n  "b": 2\n}\n');
  assert.ok(d.includes('-   "a": 1') && d.includes('+   "a": 1,') && d.includes('+   "b": 2'));
});

fs.rmSync(pasta, { recursive: true, force: true });
if (falhas) { console.log(`\n${falhas} teste(s) falharam`); process.exit(1); }
console.log("\ntodos os testes do instalador passaram");

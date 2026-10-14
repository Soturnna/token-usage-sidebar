// Testes do agregador de estado (sem dependências: node test/agent-state.test.js).
// O relógio é simulado: cada teste diz em que milissegundo cada evento chega.
const assert = require("assert");
const { criarAgregador } = require("../src/agent-state");

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log("ok   -", nome); }
  catch (e) { falhas++; console.log("FALHA -", nome, "\n      ", e.message); }
}
const ev = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: "A", ...extra });

teste("turno completo: prompt -> ferramenta -> fim -> ocioso", () => {
  const a = criarAgregador();
  a.aplicar(ev("SessionStart"), 0);               assert.strictEqual(a.resumo().estado, "idle");
  a.aplicar(ev("UserPromptSubmit"), 1000);        assert.strictEqual(a.resumo().estado, "thinking");
  a.aplicar(ev("PreToolUse", { tool_name: "Bash" }), 2000);
  assert.strictEqual(a.resumo().estado, "working");
  assert.strictEqual(a.resumo().sessoes[0].tool, "Bash");
  a.aplicar(ev("PostToolUse", { tool_name: "Bash" }), 3000);
  a.aplicar(ev("Stop"), 4000);                    assert.strictEqual(a.resumo().estado, "finished");
  a.tick(4000 + 4999);                            assert.strictEqual(a.resumo().estado, "finished");
  a.tick(4000 + 5000);                            assert.strictEqual(a.resumo().estado, "idle");
});

// O BUG ANTIGO: 6 s de silêncio desligavam o "trabalhando". Medimos pausas de
// até 163 s dentro de turnos reais. Agora o silêncio não muda nada.
teste("NÃO dorme cedo: 90 s de silêncio no meio do turno continuam 'working'", () => {
  const a = criarAgregador();
  a.aplicar(ev("UserPromptSubmit"), 0);
  a.aplicar(ev("PreToolUse", { tool_name: "Bash" }), 1000);
  for (let t = 2000; t <= 91000; t += 1000) a.tick(t);
  assert.strictEqual(a.resumo().estado, "working");
});

teste("NÃO digita sozinho: sem eventos, nada liga o trabalho", () => {
  const a = criarAgregador();
  for (let t = 0; t <= 60000; t += 1000) a.tick(t);
  assert.strictEqual(a.resumo().estado, "idle");
  assert.strictEqual(a.resumo().sessoes.length, 0);
});

teste("aprovação: '!' aparece e só sai quando a ferramenta roda", () => {
  const a = criarAgregador();
  a.aplicar(ev("PreToolUse", { tool_name: "Bash" }), 0);
  a.aplicar(ev("PermissionRequest", { tool_name: "Bash" }), 10);
  assert.strictEqual(a.resumo().estado, "approval");
  // um PreToolUse atrasado NÃO apaga o pedido
  a.aplicar(ev("PreToolUse", { tool_name: "Bash" }), 20);
  assert.strictEqual(a.resumo().estado, "approval");
  a.aplicar(ev("PostToolUse", { tool_name: "Bash" }), 5000);
  assert.strictEqual(a.resumo().estado, "working");
});

teste("aprovação também pela Notification permission_prompt", () => {
  const a = criarAgregador();
  a.aplicar(ev("Notification", { notification_type: "permission_prompt" }), 0);
  assert.strictEqual(a.resumo().estado, "approval");
});

teste("pergunta: AskUserQuestion e elicitation viram 'question'", () => {
  const a = criarAgregador();
  a.aplicar(ev("PreToolUse", { tool_name: "AskUserQuestion" }), 0);
  assert.strictEqual(a.resumo().estado, "question");
  const b = criarAgregador();
  b.aplicar(ev("Notification", { notification_type: "elicitation_dialog" }), 0);
  assert.strictEqual(b.resumo().estado, "question");
});

teste("interrupção (Esc): sem Stop, o idle_prompt devolve ao ocioso", () => {
  const a = criarAgregador();
  a.aplicar(ev("PreToolUse", { tool_name: "Read" }), 0);
  a.aplicar(ev("Notification", { notification_type: "idle_prompt" }), 60000);
  assert.strictEqual(a.resumo().estado, "idle");
});

teste("vigia: 'working' sem nenhum evento por 10 min volta a ocioso", () => {
  const a = criarAgregador();
  a.aplicar(ev("PreToolUse", { tool_name: "Bash" }), 0);
  a.tick(10 * 60 * 1000 - 1);  assert.strictEqual(a.resumo().estado, "working");
  a.tick(10 * 60 * 1000);      assert.strictEqual(a.resumo().estado, "idle");
});

teste("erro e limite de uso", () => {
  const a = criarAgregador();
  a.aplicar(ev("StopFailure", { error: "overloaded" }), 0);
  assert.strictEqual(a.resumo().estado, "error");
  a.tick(8000);                 assert.strictEqual(a.resumo().estado, "idle");
  a.aplicar(ev("StopFailure", { error: "rate_limit" }), 9000);
  assert.strictEqual(a.resumo().estado, "ratelimit");
  const b = criarAgregador();
  b.aplicar(ev("Notification", { message: "Claude usage limit reached" }), 0);
  assert.strictEqual(b.resumo().estado, "ratelimit");
});

teste("várias sessões: a mais urgente vem primeiro; SessionEnd remove", () => {
  const a = criarAgregador();
  a.aplicar({ hook_event_name: "PreToolUse", session_id: "A", tool_name: "Edit" }, 0);
  a.aplicar({ hook_event_name: "PermissionRequest", session_id: "B", tool_name: "Bash" }, 10);
  const r = a.resumo();
  assert.deepStrictEqual(r.sessoes.map((s) => s.id + ":" + s.state), ["B:approval", "A:working"]);
  assert.strictEqual(r.estado, "approval");
  a.aplicar({ hook_event_name: "SessionEnd", session_id: "B" }, 20);
  assert.deepStrictEqual(a.resumo().sessoes.map((s) => s.id), ["A"]);
});

teste("evento com carimbo mais antigo que o último aplicado é ignorado", () => {
  const a = criarAgregador();
  a.aplicar(ev("PostToolUse", { t: 2000 }), 0);
  a.aplicar(ev("Stop", { t: 3000 }), 1);
  a.aplicar(ev("PreToolUse", { tool_name: "Bash", t: 1000 }), 2);   // atrasado
  assert.strictEqual(a.resumo().estado, "finished");
});

teste("payload inválido não quebra nada", () => {
  const a = criarAgregador();
  assert.strictEqual(a.aplicar(null, 0), false);
  assert.strictEqual(a.aplicar({}, 0), false);
  assert.strictEqual(a.aplicar({ hook_event_name: 42 }, 0), false);
});

if (falhas) { console.log(`\n${falhas} teste(s) falharam`); process.exit(1); }
console.log("\ntodos os testes do agregador passaram");

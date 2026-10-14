// Simulador de eventos do Claude Code, para testar os gatos sem gastar cota.
// Usa o caminho REAL: cada evento é entregue ao relay instalado
// (%LOCALAPPDATA%\token-usage-sidebar\bin\tus-relay.exe) pelo stdin, exatamente
// como o Claude Code faz; o relay manda pelo named pipe ao app aberto.
//
//   node scripts/simular-eventos.js <cenário>
//
// Cenários: turno | pausa90 | aprovacao | pergunta | erro | limite | esc | sessoes | statusline
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const relay = path.join(os.homedir(), "AppData", "Local", "token-usage-sidebar", "bin", "tus-relay.exe");
if (!fs.existsSync(relay)) {
  console.error("Relay não encontrado em", relay, "\nAbra o app (npm start) uma vez antes: ele instala o relay.");
  process.exit(1);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
function enviar(evento, extra = {}, sessao = "sim-A", modo = "hook") {
  const payload = { hook_event_name: evento, session_id: sessao, cwd: "C:\\projetos\\simulado", ...extra };
  const t0 = Date.now();
  const r = spawnSync(relay, [modo], { input: JSON.stringify(payload) });
  const saida = String(r.stdout || "").trim();
  console.log(`${new Date().toLocaleTimeString()}  ${sessao}  ${(evento || "statusline").padEnd(18)} ${Date.now() - t0} ms  exit=${r.status}${saida ? "  stdout=" + saida : ""}`);
}

const cenarios = {
  // prompt -> pensa -> ferramentas -> termina (gato sobe, digita, "concluído", desce)
  async turno() {
    enviar("UserPromptSubmit");                         await esperar(3000);
    enviar("PreToolUse", { tool_name: "Read" });         await esperar(2000);
    enviar("PostToolUse", { tool_name: "Read" });        await esperar(3000);
    enviar("PreToolUse", { tool_name: "Edit" });         await esperar(2000);
    enviar("PostToolUse", { tool_name: "Edit" });        await esperar(2000);
    enviar("Stop", { last_assistant_message: "pronto" });
  },
  // O BUG ANTIGO: 90 s sem nenhum evento no meio do turno. O gato NÃO pode descer.
  async pausa90() {
    enviar("UserPromptSubmit");
    enviar("PreToolUse", { tool_name: "Bash" });
    console.log("… 90 s de silêncio (o gato deve continuar digitando) …");
    await esperar(90000);
    enviar("PostToolUse", { tool_name: "Bash" });        await esperar(1000);
    enviar("Stop");
  },
  // "!" até a ferramenta rodar
  async aprovacao() {
    enviar("UserPromptSubmit");                          await esperar(1500);
    enviar("PreToolUse", { tool_name: "Bash" });
    enviar("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf build" } });
    enviar("Notification", { notification_type: "permission_prompt", message: "Claude needs your permission" });
    console.log("… 10 s aguardando aprovação (o gato mostra '!') …");
    await esperar(10000);
    enviar("PostToolUse", { tool_name: "Bash" });        await esperar(2000);
    enviar("Stop");
  },
  async pergunta() {
    enviar("PreToolUse", { tool_name: "AskUserQuestion" });
    await esperar(8000);
    enviar("PostToolUse", { tool_name: "AskUserQuestion" }); await esperar(1500);
    enviar("Stop");
  },
  async erro() {
    enviar("UserPromptSubmit");                          await esperar(2000);
    enviar("StopFailure", { error: "overloaded" });
  },
  async limite() {
    enviar("UserPromptSubmit");                          await esperar(2000);
    enviar("StopFailure", { error: "rate_limit" });
  },
  // Esc interrompe: o Stop NÃO vem; o idle_prompt (~60 s depois, aqui 5 s) devolve ao ocioso
  async esc() {
    enviar("UserPromptSubmit");
    enviar("PreToolUse", { tool_name: "Read" });         await esperar(5000);
    enviar("Notification", { notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  },
  // Duas sessões: com 2 gatos, cada um acompanha uma
  async sessoes() {
    enviar("UserPromptSubmit", {}, "sim-A");
    enviar("PreToolUse", { tool_name: "Edit" }, "sim-A"); await esperar(2000);
    enviar("UserPromptSubmit", {}, "sim-B");             await esperar(2000);
    enviar("PermissionRequest", { tool_name: "Bash" }, "sim-B"); await esperar(6000);
    enviar("PostToolUse", { tool_name: "Bash" }, "sim-B"); await esperar(1000);
    enviar("Stop", {}, "sim-B");                         await esperar(3000);
    enviar("Stop", {}, "sim-A");
  },
  // Limites de uso como a statusLine os entrega (gauges mudam na hora)
  async statusline() {
    const agora = Math.floor(Date.now() / 1000);
    const corpo = {
      model: { display_name: "Opus" },
      rate_limits: {
        five_hour: { used_percentage: 37.5, resets_at: agora + 2 * 3600 },
        seven_day: { used_percentage: 61, resets_at: agora + 3 * 86400 },
      },
    };
    const r = spawnSync(relay, ["statusline"], { input: JSON.stringify(corpo) });
    console.log("statusline -> exit", r.status, "| texto da barra:", String(r.stdout).trim());
  },
};

const nome = process.argv[2];
if (!cenarios[nome]) {
  console.log("uso: node scripts/simular-eventos.js <" + Object.keys(cenarios).join(" | ") + ">");
  process.exit(1);
}
cenarios[nome]().then(() => console.log("fim do cenário", nome));

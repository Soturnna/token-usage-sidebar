// Agregador do estado do Claude Code, por sessão, a partir dos eventos de hook.
//
// Lógica pura: não conhece Electron, pipe nem relógio. Quem usa chama
// `aplicar(evento, agora)` a cada evento e `tick(agora)` de tempos em tempos
// (as transições por tempo, como "finished" -> "idle", acontecem no tick).
// Isso permite testar tudo com um relógio simulado (test/agent-state.test.js).
//
// O mapeamento evento -> estado segue a documentação oficial dos hooks
// (https://code.claude.com/docs/en/hooks) e a tabela do Coucou (MIT).

// Do mais urgente ao mais calmo. Define a ordem das sessões (e qual gato vê qual).
const PRIORIDADE = ["approval", "question", "error", "ratelimit", "working", "thinking", "finished", "idle"];

const T_FINISHED = 5000;              // "concluído" fica na tela por 5 s
const T_ERROR = 8000;                 // erro fica 8 s
const VIGIA_ATIVO = 10 * 60 * 1000;   // working/thinking sem NENHUM evento por 10 min -> idle
const VIGIA_ESPERA = 30 * 60 * 1000;  // approval/question/ratelimit esquecidos por 30 min -> idle
const T_ESQUECER = 30 * 60 * 1000;    // sessão ociosa sem eventos por 30 min some da lista

const ESPERANDO_VOCE = new Set(["approval", "question"]);
// Notification que significam "o Claude espera uma resposta sua"
const NOTIF_PERGUNTA = new Set(["elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"]);
const RE_LIMITE = /rate limit|usage limit|limite de uso|limit reached/i;

function criarAgregador() {
  const sessoes = new Map();   // session_id -> { id, state, project, tool, since, last, lastT, ordem }
  let ordem = 0;               // ordem de criação: desempate estável entre sessões
  let ultimoEvento = null;     // hora (do app) do último evento de agente recebido

  function sessao(id, agora) {
    let s = sessoes.get(id);
    if (!s) {
      s = { id, state: "idle", project: null, tool: null, since: agora, last: agora, lastT: 0, ordem: ordem++ };
      sessoes.set(id, s);
    }
    return s;
  }

  function mudar(s, estado, agora) {
    if (s.state !== estado) { s.state = estado; s.since = agora; }
  }

  // Aplica um evento. Retorna true se algo visível mudou.
  function aplicar(ev, agora) {
    if (!ev || typeof ev.hook_event_name !== "string") return false;
    const id = typeof ev.session_id === "string" && ev.session_id ? ev.session_id : "sem-sessao";
    const antes = assinatura();
    ultimoEvento = agora;

    const nome = ev.hook_event_name;
    if (nome === "SessionEnd") { sessoes.delete(id); return assinatura() !== antes; }

    const s = sessao(id, agora);
    // Os hooks são síncronos, então os eventos chegam em ordem. Ainda assim,
    // um evento com carimbo ANTERIOR ao último aplicado é descartado.
    const t = Number(ev.t) || 0;
    if (t && s.lastT && t < s.lastT) return false;
    if (t) s.lastT = t;
    s.last = agora;
    if (ev.project) s.project = String(ev.project);

    switch (nome) {
      case "SessionStart":
        mudar(s, "idle", agora); s.tool = null;
        break;
      case "UserPromptSubmit":
        mudar(s, "thinking", agora); s.tool = null;
        break;
      case "PreToolUse":
        // Pergunta ao usuário (AskUserQuestion) chega como PreToolUse
        if (ev.tool_name === "AskUserQuestion") { mudar(s, "question", agora); s.tool = null; break; }
        // Um PreToolUse que chegue depois do pedido de permissão não apaga o "!"
        if (ESPERANDO_VOCE.has(s.state)) break;
        mudar(s, "working", agora); s.tool = ev.tool_name || null;
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        // A ferramenta rodou (aprovada) ou falhou (negada): a espera acabou
        mudar(s, "working", agora);
        break;
      case "PermissionRequest":
        if (ev.tool_name === "AskUserQuestion") { mudar(s, "question", agora); s.tool = null; }
        else { mudar(s, "approval", agora); s.tool = ev.tool_name || s.tool; }
        break;
      case "Notification": {
        const tipo = ev.notification_type;
        if (tipo === "permission_prompt") { if (!ESPERANDO_VOCE.has(s.state)) mudar(s, "approval", agora); }
        else if (NOTIF_PERGUNTA.has(tipo)) mudar(s, "question", agora);
        // idle_prompt: o prompt está parado esperando você. Também é o que nos
        // salva depois de um Esc, porque o Stop NÃO dispara em interrupções.
        else if (tipo === "idle_prompt") { mudar(s, "idle", agora); s.tool = null; }
        else if (RE_LIMITE.test(ev.message || "")) mudar(s, "ratelimit", agora);
        break;
      }
      case "Stop":
        mudar(s, "finished", agora); s.tool = null;
        break;
      case "StopFailure":
        mudar(s, ev.error === "rate_limit" ? "ratelimit" : "error", agora); s.tool = null;
        break;
      default:
        // SubagentStart/Stop e outros: só contam como sinal de vida (s.last)
        break;
    }
    return assinatura() !== antes;
  }

  // Transições por tempo. Retorna true se algo visível mudou.
  function tick(agora) {
    const antes = assinatura();
    for (const s of [...sessoes.values()]) {
      const parado = agora - s.last;
      if (s.state === "finished" && agora - s.since >= T_FINISHED) mudar(s, "idle", agora);
      else if (s.state === "error" && agora - s.since >= T_ERROR) mudar(s, "idle", agora);
      else if ((s.state === "working" || s.state === "thinking") && parado >= VIGIA_ATIVO) mudar(s, "idle", agora);
      else if ((ESPERANDO_VOCE.has(s.state) || s.state === "ratelimit") && parado >= VIGIA_ESPERA) mudar(s, "idle", agora);
      if (s.state === "idle" && parado >= T_ESQUECER) sessoes.delete(s.id);
    }
    return assinatura() !== antes;
  }

  // Sessões da mais urgente para a mais calma (empate: a mais antiga primeiro)
  function ordenadas() {
    return [...sessoes.values()].sort((a, b) =>
      PRIORIDADE.indexOf(a.state) - PRIORIDADE.indexOf(b.state) || a.ordem - b.ordem);
  }

  function resumo() {
    const lista = ordenadas().map((s) => ({ id: s.id, state: s.state, project: s.project, tool: s.tool, since: s.since }));
    return { estado: lista.length ? lista[0].state : "idle", sessoes: lista, ultimoEvento };
  }

  // Só o que o renderer enxerga (para saber se vale a pena reenviar)
  function assinatura() {
    return ordenadas().map((s) => s.id + ":" + s.state + ":" + (s.tool || "") + ":" + (s.project || "")).join("|");
  }

  return { aplicar, tick, resumo };
}

module.exports = { criarAgregador, PRIORIDADE, T_FINISHED, T_ERROR, VIGIA_ATIVO };

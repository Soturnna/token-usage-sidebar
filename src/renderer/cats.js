// Pets virtuais (gatinhos) da barra lateral.
//
// Máquina de estados:
//   (início) greeting "oi!" --(1,8 s)--> [base]
//   [base] = estado da sessão do Claude Code que este gato acompanha, ou [ocioso]
//
//   Estados do AGENTE (vêm dos hooks; o gato fica no "poleiro", em cima da barra):
//     thinking "…" | working (digitando) | alert "!" | asking "?" |
//     finished (pulinho) | error | ratelimit
//     poleiro --(sessão voltou a ociosa)--> descending --> kneading --> idle
//
//   [ocioso] = idle (sentado, a cabeça acompanha o cursor) | licking | playing,
//              sorteados ao acaso; sleeping SÓ após 2 min sem evento do agente
//              e com o cursor longe (acorda quando o cursor chega perto)
//   [ocioso] --(mouse perto)--> stalking --> pouncing --> swatting
//            swatting --(presa ainda perto e interessante)--> stalking (rearma)
//            swatting / stalking --(presa longe ou enjoou)--> [ocioso sorteado]
//   [ocioso] <--(hover)--> petting   (durante a caça, o carinho espera ela acabar)
//
//   Toque: 1 clique -> angry (irritado, 800 ms) -> [base]
//          3 cliques em 1,7 s -> dizzy (tonto, 3,3 s) -> [base]
//          (cliques são ignorados em alert/asking: o "!" não pode sumir)
//   alert/asking interrompem qualquer reação; os demais estados do agente
//   esperam a reação terminar (no máximo 3,3 s).
//
// Calibração (800 ms, 3 cliques/1,7 s, 3,3 s, 2 min de sono) inspirada na
// especificação do Coucou, de Louis Raillé (MIT). Arte, nomes e animações aqui
// são originais deste projeto.
//
// A arte são GIFs de pixel art em assets/cats/. Cada estado troca o `src` da
// imagem do gato; balões ("!", "?", "…", "oi!"), corações, estrelas de tontura e
// a marca de raiva são desenhados em código (SVG) por cima do GIF.

// ----- Tamanho e posição (tudo deriva de CAT_ESCALA) -----
const CAT_ESCALA = 1.25;               // 1 = tamanho base; aumente/diminua aqui
const CAT_BASE = 56;                   // lado do gato em px quando a escala é 1
const CAT_SIZE = Math.round(CAT_BASE * CAT_ESCALA);

// Deslocamentos medidos no tamanho base (escala 1); são multiplicados pela escala
const OFFSET_BASE = {
  roda: -34,      // quanto o gato "sobe" acima do topo da roda ao dormir (barriga apoiada no arco)
  topo: -6,       // posição vertical em relação ao topo da barra ao trabalhar
  afastar: 9,     // separação lateral entre os dois gatos ao trabalhar
};
const px = (v) => Math.round(v * CAT_ESCALA);

// ----- Tempos da máquina de estados (ms) -----
const T_DESCEND = 850;                 // duração da descida até a roda
const T_KNEAD = 2200;                  // "amassar pãozinho" depois de descer
const T_OLA = 1800;                    // aceno de "oi!" ao abrir a interface
const T_IRRITADO = 800;                // um clique: irritado por este tempo
const T_TONTO = 3300;                  // muitos cliques: tonto por este tempo
const CLIQUES_TONTO = 3;               // ...quantos cliques
const JANELA_CLIQUES = 1700;           // ...dentro desta janela (ms)
const SONO_APOS = 2 * 60 * 1000;       // dorme só após 2 min sem NENHUM evento do agente
const SONO_DIST = 150;                 // ...e com o cursor a mais que isto (px de tela)
const T_DESPERTAR = [300, 800];        // gato não acorda instantaneamente: atraso sorteado
const T_CARINHO = 350;                 // hover parado sobre o gato antes de virar carinho
const T_OLHAR_VAGAR = 3000;            // cursor parado por isto: o olhar começa a passear
const T_USUARIO_ATIVO = 8000;          // mouse mexido há menos que isto = você está "ativo"

// ----- Comportamentos ociosos (sorteados com Math.random) -----
// peso: chance relativa de ser escolhido; min/max: duração em ms.
// Dormir não entra na roleta (peso 0): só acontece pela regra de inatividade
// real (SONO_APOS), nunca por sorteio nem por ruído.
const OCIOSO = {
  idle:     { peso: 5, min: 15000, max: 40000 },
  licking:  { peso: 2, min: 6000,  max: 10000 },
  playing:  { peso: 2, min: 7000,  max: 12000 },
  sleeping: { peso: 0 },
};

// ----- Estado do agente -> estado do gato -----
// "idle" do agente não está aqui: sem trabalho, o gato fica no [ocioso].
const AGENTE_PARA_GATO = {
  thinking: "thinking", working: "working", approval: "alert", question: "asking",
  finished: "finished", error: "error", ratelimit: "ratelimit",
};
// Estados exibidos no poleiro (em cima da barra)
const POLEIRO = new Set(Object.values(AGENTE_PARA_GATO));
// Urgência para decidir qual sessão cada gato acompanha (menor = mais urgente).
// working e thinking têm o mesmo nível: assim dois gatos não trocam de sessão
// a cada ferramenta.
const NIVEL = { approval: 0, question: 0, error: 1, ratelimit: 1, working: 2, thinking: 2, finished: 3, idle: 4 };

// ----- Caça ao mouse -----
// Como um felino com uma presa, a caça é uma SEQUÊNCIA, não um loop:
//   stalking (foca + rebaixa a postura -> se arma, rebolando)
//   -> pouncing (bote em arco na direção do cursor)
//   -> swatting (patada) -> se arma de novo, ou desiste se a presa sumiu.
// Distâncias no tamanho base (escaladas por px()). Dois raios = histerese:
// evita que o gato fique "piscando" entre caçar e não caçar na fronteira.
const CACA = {
  perto: 60,          // cursor mais perto que isto: começa a caçar
  longe: 90,          // cursor mais longe que isto: perde o interesse
  boteMaxX: 14,       // alcance horizontal máximo do bote
  boteMaxY: 8,        // alcance vertical máximo do bote
  alturaBote: 12,     // altura do arco do salto
};
// Tempos (ms) como [min, max]: cada caça sorteia valores diferentes, para o
// gato não parecer uma máquina repetindo o mesmo ritmo.
const T_CACA = {
  focar:    [700, 1300],    // olhar fixo e rebaixar a postura
  armar:    [600, 1200],    // rebolar o traseiro antes do pulo
  bote:     420,            // duração do salto
  patada:   700,            // duração da patada após cair
  voltar:   320,            // pulinho de volta ao lugar
  rearmar:  [900, 1600],    // descanso antes de um novo bote, se a presa continua perto
  desistir: 900,            // presa longe por este tempo = volta ao ócio
};
// Para que lado os GIFs de caça olham. Se o cursor estiver do outro lado, o GIF
// é espelhado para o gato encarar a setinha.
const CACA_GIF_OLHA_PARA = "direita";
const CACA_ESTADOS = new Set(["stalking", "pouncing", "swatting"]);

// ----- Arquivos -----
// Caminho relativo a src/renderer/index.html
const CAT_DIR = "../../assets/cats/";
// Qual GIF cada estado usa (petting reaproveita o de dormir + corações)
const CAT_GIF = {
  working: "working",
  descending: "descending",
  kneading: "kneading",
  sleeping: "sleeping",
  licking: "licking",
  playing: "playing",
  stalking: "crouch",
  pouncing: "pounce",
  swatting: "swat",
  petting: "sleeping",
  angry: "angry",
  // novos estados
  greeting: "greeting",
  idle: "idle",
  dizzy: "dizzy",
  thinking: "thinking",
  alert: "alert",
  asking: "alert",
  finished: "finished",
  error: "angry",
  ratelimit: "sleeping",   // esgotado: deitado no poleiro, com a ampulheta
};
// Enquanto um GIF não existir, usa outro parecido em vez de deixar o gato
// invisível. Basta colocar o arquivo novo em assets/cats/ que ele é usado.
const CAT_GIF_RESERVA = {
  licking: "kneading",
  playing: "kneading",
  crouch: "angry",         // o "angry" é o gato agachado de perfil, de orelhas baixas
  pounce: "crouch",        // sem GIF de pulo: o movimento do bote vem do código
  swat: "crouch",
  // novos estados: o "kneading" é o gato sentado de frente
  greeting: "kneading",
  idle: "kneading",
  thinking: "kneading",
  alert: "kneading",
  finished: "kneading",
  dizzy: "angry",
};
// Prefixo dos arquivos de cada gato: 0 = ruivo (cat_), 1 = cinza (cat2_)
const CAT_PREFIX = ["cat_", "cat2_"];

// Qual roda cada gato ocupa ao descansar: 0 = 5h (de cima), 1 = 7d (de baixo)
const CAT_HOME = [0, 1];

// Efeitos desenhados por cima do GIF: UM só SVG por gato (coordenadas 0–68 = o
// canvas do GIF), com um grupo por efeito; o CSS mostra o grupo do estado atual.
//   fx-love  (carinho): corações e nota acima da cabeça do gato deitado (x ≈ 45–53)
//   fx-dizzy (tonto):   três estrelas orbitando a cabeça
//   fx-angry (irritado): a "veia saltada" dos quadrinhos
const CAT_HEART = "M0 3 a3 3 0 0 1 5.2-2 A3 3 0 0 1 10.4 3 q0 3.6-5.2 6.6 Q0 6.6 0 3Z";
const CAT_STAR = "M0 -3 L0.9 -0.9 L3 0 L0.9 0.9 L0 3 L-0.9 0.9 L-3 0 L-0.9 -0.9Z";
const CAT_FX = `
<svg class="cat-fx" viewBox="0 0 68 68" aria-hidden="true">
  <g class="fx fx-love">
    <g transform="translate(46 15) scale(1.1)"><path class="heart h1" d="${CAT_HEART}"/></g>
    <g transform="translate(34 19) scale(0.8)"><path class="heart h2" d="${CAT_HEART}"/></g>
    <g transform="translate(57 21)"><path class="note n1" d="M0 8 v-7 l4.5-1.2 v7 M0 8 a1.6 1.3 0 1 1-0.1 0 M4.5 6.8 a1.6 1.3 0 1 1-0.1 0" stroke-width="1.3" fill="none"/></g>
  </g>
  <g class="fx fx-dizzy">
    <g class="orbit o1"><path class="star" transform="translate(46 15)" d="${CAT_STAR}"/></g>
    <g class="orbit o2"><path class="star" transform="translate(46 15)" d="${CAT_STAR}"/></g>
    <g class="orbit o3"><path class="star" transform="translate(46 15)" d="${CAT_STAR}"/></g>
  </g>
  <g class="fx fx-angry">
    <g transform="translate(50 17)"><path class="vein" d="M0 2 h3 v-2 M5 0 v2 h3 M8 5 h-3 v2 M3 7 v-2 h-3" fill="none" stroke-width="1.6"/></g>
  </g>
</svg>`;

// Balões (o que o gato "diz"). Desenhados como pixel art simples: fundo claro,
// tinta escura, rabicho para baixo. O conteúdo muda conforme o estado.
const BALAO_CONTEUDO = {
  alert: `<rect class="ink" x="10" y="3" width="3" height="7"/><rect class="ink" x="10" y="12" width="3" height="3"/>`,
  asking: `<rect class="ink" x="8" y="3" width="7" height="2"/><rect class="ink" x="8" y="5" width="2" height="2"/><rect class="ink" x="13" y="5" width="2" height="4"/><rect class="ink" x="10" y="8" width="4" height="2"/><rect class="ink" x="10" y="10" width="3" height="1"/><rect class="ink" x="10" y="12" width="3" height="3"/>`,
  thinking: `<rect class="ink dot d1" x="5" y="8" width="3" height="3"/><rect class="ink dot d2" x="10" y="8" width="3" height="3"/><rect class="ink dot d3" x="15" y="8" width="3" height="3"/>`,
  ratelimit: `<path class="ink" d="M7 3 h9 v2 h-1 v2 h-1 v1 h-1 v2 h1 v1 h1 v2 h1 v2 h-9 v-2 h1 v-2 h1 v-1 h1 v-2 h-1 v-1 h-1 v-2 h-1z"/>`,
  greeting: `<text class="ink txt" x="11.5" y="12.5" text-anchor="middle">oi!</text>`,
};
const balaoSvg = (conteudo) => `
<svg class="cat-bubble" viewBox="0 0 23 22" aria-hidden="true">
  <path class="bg" d="M2 0 h19 v1 h1 v1 h1 v14 h-1 v1 h-1 v1 h-12 l-3 3 v-3 h-4 v-1 h-1 v-1 h-1 v-14 h1 v-1 h1z"/>
  ${conteudo}
</svg>`;

// ----- Utilidades de sorteio -----
const aleatorio = (min, max) => min + Math.random() * (max - min);
const sortearFaixa = ([min, max]) => aleatorio(min, max);
const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

// Sorteio ponderado entre os comportamentos ociosos. `evitar` tira o atual da
// roleta, para o gato não "trocar" de lamber para lamber. Peso 0 (dormir) nunca sai.
// O contexto muda os pesos: com você mexendo o mouse o gato fica mais
// brincalhão; com tudo parado ele prefere se lamber (e logo vai cochilar).
function sortearOcioso(evitar) {
  const ativo = CatPets.usuarioAtivo();
  const fator = { playing: ativo ? 2 : 0.5, licking: ativo ? 1 : 1.6 };
  const peso = (k) => OCIOSO[k].peso * (fator[k] || 1);
  const opcoes = Object.keys(OCIOSO).filter((k) => k !== evitar && OCIOSO[k].peso > 0);
  const total = opcoes.reduce((s, k) => s + peso(k), 0);
  let r = Math.random() * total;
  for (const k of opcoes) { r -= peso(k); if (r < 0) return k; }
  return opcoes[opcoes.length - 1];
}

// ----- Resolução dos arquivos -----
// Testa (uma vez por arquivo) se um GIF existe, carregando-o numa Image invisível.
const _existe = new Map();
function existe(src) {
  if (!_existe.has(src)) {
    _existe.set(src, new Promise((ok) => {
      const teste = new Image();
      teste.onload = () => ok(true);
      teste.onerror = () => ok(false);
      teste.src = src;
    }));
  }
  return _existe.get(src);
}

// Escolhe o GIF de um estado, nesta ordem:
//   1. o arquivo próprio do gato (cat_ ou cat2_)
//   2. para o gato 2: o do gato 1 em tons de cinza
//   3. o GIF reserva do estado (CAT_GIF_RESERVA), repetindo a mesma busca
async function resolveSprite(index, nome) {
  const proprio = CAT_DIR + CAT_PREFIX[index] + nome + ".gif";
  if (await existe(proprio)) return { src: proprio, nome, cinza: false };
  const doGato1 = CAT_DIR + CAT_PREFIX[0] + nome + ".gif";
  if (index > 0 && await existe(doGato1)) return { src: doGato1, nome, cinza: true };
  if (CAT_GIF_RESERVA[nome]) return resolveSprite(index, CAT_GIF_RESERVA[nome]);
  return { src: proprio, nome, cinza: false };
}

// Mede, em tempo real, onde estão as rodas dentro da pílula. Medir (em vez de
// cravar valores) mantém o gato ancorado mesmo se a barra mudar de tamanho.
function ringElements() { return [...document.querySelectorAll("#pill .gauge .ring")]; }
function ringAnchors(host) {
  const base = host.getBoundingClientRect();
  return ringElements().map((r) => {
    const b = r.getBoundingClientRect();
    return { cx: b.left - base.left + b.width / 2, top: b.top - base.top };
  });
}

class Cat {
  constructor(host, index) {
    this.host = host;
    this.index = index;
    this.state = null;
    this.timer = null;        // próxima transição automática (descida, ócio...)
    this.saida = null;        // desistência da caça
    this.hovered = false;     // o mouse está sobre o gato? (lembrado entre estados)
    this.ultimoOcioso = "idle";       // para onde voltar depois de carinho/bravo/oi
    this.cursor = null;       // última posição conhecida do cursor (tela)
    this.salto = null;        // animação do bote em andamento (Web Animations API)
    this.interesse = 0;       // botes restantes antes de enjoar da presa
    this.rearmando = false;
    this.sessao = null;       // id da sessão do Claude Code que este gato acompanha
    this.agente = null;       // estado de poleiro pedido pelo agente (ou null = sem trabalho)
    this.reagindo = false;    // em greeting/angry/dizzy (reação com hora para acabar)
    this.reacao = null;       // timer do fim da reação
    this.cliques = [];        // horários dos últimos cliques (detecção de "tonto")
    this.olhar = { x: 0, y: 0 };   // direção suavizada da cabeça (-1..1)
    this.centro = null;       // centro do gato na janela (cache, medido em place())
    this.proximo = null;      // para onde vai depois de amassar pãozinho ("sleeping" = se ajeitando)
    this.tDespertar = null;   // acordar com atraso natural
    this.tCarinho = null;     // intenção de carinho (hover)
    this.cursorMovidoEm = 0;  // quando o cursor se mexeu pela última vez
    this.vagar = null;        // alvo do olhar quando o cursor está parado: { x, y, ate }

    this.el = document.createElement("div");
    this.el.className = "cat cat-" + index;
    this.img = document.createElement("img");
    this.img.className = "cat-img";
    this.img.alt = "";
    this.img.draggable = false;
    this.el.appendChild(this.img);
    this.el.insertAdjacentHTML("beforeend", CAT_FX);
    this.balao = document.createElement("div");
    this.balao.className = "cat-balao";
    this.el.appendChild(this.balao);
    // Área sensível: só o corpo do gato (tamanho conforme o GIF exibido, no CSS).
    // É um <button> de verdade: clicável também pelo teclado (Enter/Espaço).
    this.hit = document.createElement("button");
    this.hit.type = "button";
    this.hit.className = "cat-hit";
    this.hit.setAttribute("aria-label", "Gatinho " + (index + 1) + ": cutucar");
    this.el.appendChild(this.hit);
    host.appendChild(this.el);

    // O clique no gato não pode iniciar o arraste da barra.
    this.hit.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.hit.addEventListener("click", (e) => { e.stopPropagation(); this.poke(); });
    // Carinho com "intenção": o mouse precisa ficar um instante sobre o gato
    // (passar de raspão não conta); ao sair, o carinho acaba na hora.
    this.hit.addEventListener("mouseenter", () => {
      this.hovered = true;
      clearTimeout(this.tCarinho);
      this.tCarinho = setTimeout(() => this.pet(), T_CARINHO);
    });
    this.hit.addEventListener("mouseleave", () => { this.hovered = false; clearTimeout(this.tCarinho); this.pet(); });
  }

  destroy() {
    clearTimeout(this.timer); clearTimeout(this.reacao); clearTimeout(this.saida);
    clearTimeout(this.tDespertar); clearTimeout(this.tCarinho);
    this.setBatting(false);
    this.cancelarSalto();
    this.el.remove();
  }

  get ocioso() { return !!OCIOSO[this.state]; }
  get cacando() { return CACA_ESTADOS.has(this.state); }

  // Troca o estado, a imagem e reposiciona o gato
  set(state) {
    if (OCIOSO[state]) {
      this.ultimoOcioso = state;
      // Se ia descansar com o mouse já em cima, entra direto no carinho
      if (this.hovered) state = "petting";
    }
    if (this.state === state) return;
    clearTimeout(this.timer);
    clearTimeout(this.saida); this.saida = null;
    clearTimeout(this.tDespertar); this.tDespertar = null;
    if (state !== "kneading") this.proximo = null;

    // classList (e não className) para preservar is-gray entre estados
    if (this.state) this.el.classList.remove("is-" + this.state);
    this.el.classList.add("is-" + state);
    this.el.classList.remove("is-armed");
    if (!CACA_ESTADOS.has(state)) {
      // Saiu da caça: desfaz o espelhamento e volta do bote direto ao lugar
      this.el.classList.remove("is-flip");
      this.cancelarSalto();
    }
    this.state = state;

    this.updateSprite(state);
    this.atualizarBalao(state);
    this.setBatting(state === "playing");
    this.place();

    if (state === "descending") this.timer = setTimeout(() => this.set("kneading"), T_DESCEND);
    // Amassar pãozinho: depois de descer (-> idle) ou ao se ajeitar para dormir (-> sleeping)
    if (state === "kneading") { const prox = this.proximo || "idle"; this.timer = setTimeout(() => this.set(prox), T_KNEAD); }
    if (state === "stalking") {
      // Primeira vez: foco demorado. Depois de uma patada: só uma pausa para rearmar.
      this.espreitar(this.rearmando ? T_CACA.rearmar : T_CACA.focar);
      this.rearmando = false;
    }
    if (state === "pouncing") this.darBote();
    if (state === "swatting") this.timer = setTimeout(() => this.depoisDaPatada(), T_CACA.patada);
    // Ócio: depois de um tempo aleatório, sorteia o próximo comportamento
    // (dormir não tem prazo: dura até o gato ser acordado)
    if (OCIOSO[state] && OCIOSO[state].min) {
      const { min, max } = OCIOSO[state];
      this.timer = setTimeout(() => this.set(sortearOcioso(state)), aleatorio(min, max));
    }
  }

  // Mostra (ou esconde) o balão do estado. Só reescreve se o conteúdo mudou.
  atualizarBalao(state) {
    const conteudo = BALAO_CONTEUDO[state] || "";
    if (this.balao.dataset.tipo === (conteudo ? state : "")) return;
    this.balao.dataset.tipo = conteudo ? state : "";
    this.balao.innerHTML = conteudo ? balaoSvg(conteudo) : "";
  }

  // Aponta a imagem para o GIF do estado. A troca é assíncrona porque pode ser
  // preciso verificar se o arquivo existe (cat2_, GIFs novos).
  updateSprite(state) {
    resolveSprite(this.index, CAT_GIF[state]).then(({ src, nome, cinza }) => {
      if (this.state !== state) return;               // estado já mudou de novo
      this.el.classList.toggle("is-gray", cinza);
      this.el.dataset.gif = nome;                       // o CSS ajusta a área de clique ao GIF real
      // Só reatribui se mudou: assim sleeping -> petting não reinicia o GIF
      if (this.img.getAttribute("src") !== src) this.img.setAttribute("src", src);
    });
  }

  // "Brincando com a UI": a roda do gato balança como um novelo
  setBatting(on) {
    const ring = ringElements()[CAT_HOME[this.index]];
    if (ring) ring.classList.toggle("is-batted", on);
  }

  // Calcula a posição conforme o estado: em cima (mesa) ou sobre a roda.
  // Usa `right` (distância até a borda DIREITA da janela), porque a barra é
  // ancorada à direita: quando a janela alarga no hover, esse valor não muda
  // e o gato não salta. Com `left`, ele ficaria para trás até ser recalculado.
  place() {
    const anchors = ringAnchors(this.host);
    const home = anchors[CAT_HOME[this.index]] || anchors[0];
    if (!home) return;
    const base = this.host.getBoundingClientRect();
    const fromRight = (cx) => Math.round(base.width - (cx + CAT_SIZE / 2)) + "px";

    if (POLEIRO.has(this.state)) {
      // Poleiro: em cima, sobre a curva superior da barra (todos os estados do agente)
      const pill = document.getElementById("pill").getBoundingClientRect();
      const cx = pill.left - base.left + pill.width / 2;
      const desvio = px(OFFSET_BASE.afastar) * (this.index === 0 ? -1 : 1);   // dois gatos não se sobrepõem
      this.el.style.right = fromRight(cx + desvio);
      this.el.style.top = Math.round(pill.top - base.top + px(OFFSET_BASE.topo)) + "px";
    } else {
      // Repouso: sobre o arco superior da roda
      this.el.style.right = fromRight(home.cx);
      this.el.style.top = Math.round(home.top + px(OFFSET_BASE.roda)) + "px";
    }
    this.medirCentro();
  }

  // Guarda o centro do gato (coordenadas da janela). O olhar usa isto a cada
  // quadro sem precisar medir o layout de novo.
  medirCentro() {
    const r = this.el.getBoundingClientRect();
    this.centro = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Hover = carinho, a partir de qualquer ócio. Durante a caça o gato está
  // concentrado: o carinho fica para quando ela terminar (ver `set`).
  // Ao sair o mouse, volta ao comportamento ocioso em que estava.
  pet() {
    if (this.hovered && this.ocioso) this.set("petting");
    else if (!this.hovered && this.state === "petting") this.set(this.ultimoOcioso);
  }

  // Clique = cutucada. Um clique deixa o gato irritado por 800 ms; três cliques
  // em 1,7 s o deixam tonto por 3,3 s. Depois ele volta ao estado-base (o que
  // estava fazendo, ou o que o agente pede agora).
  // Ignorado com "!"/"?" (o aviso não pode sumir), na descida e já tonto.
  poke() {
    if (this.state === "alert" || this.state === "asking" || this.state === "descending" || this.state === "dizzy") return;
    const agora = performance.now();
    this.cliques = this.cliques.filter((t) => agora - t < JANELA_CLIQUES);
    this.cliques.push(agora);
    if (this.cliques.length >= CLIQUES_TONTO) {
      this.cliques = [];
      this.reagir("dizzy", T_TONTO);
    } else {
      this.reagir("angry", T_IRRITADO);
    }
  }

  // Uma reação com hora para acabar (oi!, irritado, tonto). Ao terminar, o gato
  // volta ao estado-base. Reações repetidas reiniciam o relógio.
  reagir(estado, ms) {
    this.reagindo = true;
    this.set(estado);
    // Reinicia o "susto" (encolhida) mesmo se já estava irritado
    this.el.classList.remove("is-poked");
    void this.el.offsetWidth;
    if (estado !== "greeting") this.el.classList.add("is-poked");
    clearTimeout(this.reacao);
    this.reacao = setTimeout(() => { this.reagindo = false; this.irParaBase(); }, ms);
  }

  // Estado-base: o que o agente pede (poleiro) ou o último comportamento ocioso
  irParaBase() {
    clearTimeout(this.reacao);
    this.reagindo = false;
    if (this.agente) return this.set(this.agente);
    if (POLEIRO.has(this.state)) return this.set("descending");    // o trabalho acabou: desce
    if (this.state === "greeting" || this.state === "angry" || this.state === "dizzy") this.set(this.ultimoOcioso);
  }

  // O agente mudou de estado (já traduzido para o estado do gato, ou null)
  setAgente(alvo) {
    if (alvo === this.agente) return;
    this.agente = alvo;
    // Durante uma reação, só o "!" e o "?" interrompem; o resto espera (≤ 3,3 s)
    if (this.reagindo && alvo !== "alert" && alvo !== "asking") return;
    this.irParaBase();
  }

  // Regra do sono: só dorme se o agente está parado há 2 min E o cursor está
  // longe. Antes de deitar, se ajeita (amassa pãozinho). Um evento do agente
  // acorda na hora; o cursor chegando perto acorda com atraso (ver onCursor).
  avaliarSono(agenteParado) {
    if (!this.ocioso || this.hovered) return;
    const longe = this.distanciaDaPresa() > SONO_DIST;
    if (this.state === "sleeping") { if (!agenteParado) this.set("idle"); }
    else if (agenteParado && longe) { this.proximo = "sleeping"; this.set("kneading"); }
  }

  // Cursor por perto de um gato dormindo: acorda depois de um instante (sorteado).
  // Se o cursor se afasta antes, ele continua dormindo.
  despertarSePerto(dist) {
    if (dist > SONO_DIST) { clearTimeout(this.tDespertar); this.tDespertar = null; return; }
    if (this.tDespertar) return;
    this.tDespertar = setTimeout(() => {
      this.tDespertar = null;
      if (this.state === "sleeping") this.set("idle");
    }, sortearFaixa(T_DESPERTAR));
  }

  // Olhar (cabeça): direção ao cursor normalizada por tanh, como na spec do
  // Coucou, e suavizada exponencialmente (a cabeça "segue com atraso").
  // Com o cursor parado, o olhar passeia: pequenas olhadas para os lados, e de
  // vez em quando volta ao cursor. É o que tira a cara de "robô mirando".
  atualizarOlhar(dt, semMovimento) {
    let ax = 0, ay = 0;
    if (this.state === "idle" && this.cursor && this.centro && !semMovimento) {
      const agora = performance.now();
      if (agora - this.cursorMovidoEm > T_OLHAR_VAGAR) {
        if (!this.vagar || agora > this.vagar.ate) {
          const ate = agora + aleatorio(1200, 3500);   // quanto tempo segura esta olhada
          this.vagar = Math.random() < 0.3
            ? { cursor: true, ate }                                  // volta a olhar o cursor
            : { x: aleatorio(-0.6, 0.6), y: aleatorio(-0.45, 0.3), ate };
        }
      } else this.vagar = null;
      if (this.vagar && !this.vagar.cursor) { ax = this.vagar.x; ay = this.vagar.y; }
      else {
        ax = Math.tanh((this.cursor.x - (window.screenX + this.centro.x)) / 260);
        ay = Math.tanh((this.cursor.y - (window.screenY + this.centro.y)) / 200);
      }
    }
    const k = 1 - Math.exp(-dt / 120);
    const nx = this.olhar.x + (ax - this.olhar.x) * k;
    const ny = this.olhar.y + (ay - this.olhar.y) * k;
    // Só escreve no estilo quando a cabeça realmente se move (evita recalcular
    // o CSS a cada quadro com o gato parado)
    if (Math.abs(nx - this.olhar.x) < 0.001 && Math.abs(ny - this.olhar.y) < 0.001) return;
    this.olhar.x = nx; this.olhar.y = ny;
    this.el.style.setProperty("--olhar-x", nx.toFixed(3));
    this.el.style.setProperty("--olhar-y", ny.toFixed(3));
  }

  // Centro do gato em coordenadas de tela (o cursor chega em coordenadas de tela)
  centroNaTela() {
    const r = this.el.getBoundingClientRect();
    return { x: window.screenX + r.left + r.width / 2, y: window.screenY + r.top + r.height / 2, r };
  }

  distanciaDaPresa() {
    if (!this.cursor) return Infinity;
    const c = this.centroNaTela();
    return Math.hypot(this.cursor.x - c.x, this.cursor.y - c.y);
  }
  presaPerto() { return this.distanciaDaPresa() <= px(CACA.longe); }

  // Recebe a posição global do cursor (só chega quando ele se MOVE)
  onCursor(p) {
    this.cursor = p;
    this.cursorMovidoEm = performance.now();
    if (this.state === "pouncing") return;            // no ar: não muda de ideia
    const c = this.centroNaTela();
    const esquerda = p.x < c.x;

    // Se ajeitando para dormir e o cursor chegou: desiste do cochilo
    if (this.state === "kneading" && this.proximo === "sleeping" && this.distanciaDaPresa() <= SONO_DIST) {
      this.set("idle");
      return;
    }
    if (this.ocioso) {
      if (this.hovered) return;                        // em cima do gato = carinho, não caça
      const dist = this.distanciaDaPresa();
      // Dormindo: o cursor por perto acorda, com um atraso natural
      if (this.state === "sleeping") { this.despertarSePerto(dist); return; }
      if (CatPets.reduzirMovimento) return;            // sem saltos com "reduzir movimento"
      if (dist < px(CACA.perto)) {
        this.interesse = Math.round(aleatorio(2, 3));  // quantos botes antes de enjoar
        this.olharPara(esquerda);
        this.set("stalking");
      }
      return;
    }
    if (!this.cacando) return;

    // Caçando: acompanha a presa com o olhar. Presa que se mexe renova o
    // interesse; presa parada perde a graça (ver depoisDaPatada).
    this.olharPara(esquerda);
    this.interesse = Math.max(this.interesse, 2);
    if (!this.presaPerto()) {
      if (!this.saida) {
        this.saida = setTimeout(() => {
          this.saida = null;
          if (this.state === "stalking") this.set(sortearOcioso());
        }, T_CACA.desistir);
      }
    } else {
      clearTimeout(this.saida); this.saida = null;
    }
  }

  // Fase 1 — foca e rebaixa a postura; fase 2 — se arma (rebola); então o bote.
  // Antes de cada fase confere se a presa continua ao alcance.
  espreitar(faixaFoco) {
    this.timer = setTimeout(() => {
      if (!this.presaPerto()) return this.set(sortearOcioso());
      this.el.classList.add("is-armed");
      this.timer = setTimeout(() => {
        if (this.presaPerto()) this.set("pouncing");
        else this.set(sortearOcioso());
      }, sortearFaixa(T_CACA.armar));
    }, sortearFaixa(faixaFoco));
  }

  // O bote: salto em arco na direção do cursor, com alcance limitado e sem
  // sair da janela (o que passa da borda da janela não é desenhado).
  darBote() {
    const c = this.centroNaTela();
    const alvo = this.cursor || c;
    const maxX = px(CACA.boteMaxX), maxY = px(CACA.boteMaxY);
    const dx = limitar(alvo.x - c.x, -Math.min(maxX, c.r.left), Math.min(maxX, innerWidth - c.r.right));
    const dy = limitar(alvo.y - c.y, -maxY, maxY);
    const topo = Math.min(dy, 0) - px(CACA.alturaBote);   // ponto mais alto do arco
    this.interesse -= 1;
    this.boteFim = { dx, dy };

    this.cancelarSalto();
    this.salto = this.el.animate([
      { transform: "translate(0, 0)" },
      { transform: `translate(${dx * 0.55}px, ${topo}px)`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px)` },
    ], { duration: T_CACA.bote, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)", fill: "forwards" });
    this.salto.onfinish = () => { if (this.state === "pouncing") this.set("swatting"); };
  }

  // Depois da patada: pulinho de volta ao lugar e decide se caça de novo
  depoisDaPatada() {
    this.voltarAoLugar(() => {
      if (this.state !== "swatting") return;
      if (this.interesse > 0 && this.presaPerto()) { this.rearmando = true; this.set("stalking"); }
      else this.set(sortearOcioso());
    });
  }

  voltarAoLugar(fim) {
    if (!this.salto) return fim();
    const { dx, dy } = this.boteFim || { dx: 0, dy: 0 };
    const volta = this.el.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.5}px, ${Math.min(dy, 0) - px(4)}px)`, offset: 0.5 },
      { transform: "translate(0, 0)" },
    ], { duration: T_CACA.voltar, easing: "ease-in-out", fill: "forwards" });
    this.salto.onfinish = null;
    this.salto.cancel();
    this.salto = volta;
    volta.onfinish = () => { this.cancelarSalto(); fim(); };
  }

  cancelarSalto() {
    if (!this.salto) return;
    this.salto.onfinish = null;
    this.salto.cancel();
    this.salto = null;
  }

  // Espelha o GIF quando o cursor está do lado oposto ao que o GIF olha
  olharPara(esquerda) {
    const gifOlhaEsquerda = CACA_GIF_OLHA_PARA === "esquerda";
    this.el.classList.toggle("is-flip", esquerda !== gifOlhaEsquerda);
  }
}

// ----- Gerenciador: quantos gatos existem e o que cada um acompanha -----
const CatPets = {
  host: null,
  cats: [],
  count: 0,
  sessoes: [],              // última lista de sessões do agente (mais urgente primeiro)
  ultimoEvento: Date.now(), // último evento do agente (para a regra do sono)
  pedirFrequencia: null,    // callback: quantas amostras/s do cursor o main deve mandar
  frequencia: 0,
  reduzirMovimento: false,
  ultimoMovimento: 0,       // quando o cursor se mexeu pela última vez (contexto do ócio)
  _quadro: 0,

  usuarioAtivo() { return performance.now() - this.ultimoMovimento < T_USUARIO_ATIVO; },

  init(host, { pedirFrequencia } = {}) {
    this.host = host;
    this.pedirFrequencia = pedirFrequencia || null;
    // Injeta no CSS os valores definidos aqui (fonte única da verdade)
    host.style.setProperty("--cat-size", CAT_SIZE + "px");
    host.style.setProperty("--cat-descend", T_DESCEND + "ms");
    addEventListener("resize", () => this.cats.forEach((c) => c.place()));
    // "Reduzir movimento" do Windows: sem caça, sem inclinação da cabeça, sem loops (CSS)
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    this.reduzirMovimento = mq.matches;
    mq.addEventListener("change", (e) => { this.reduzirMovimento = e.matches; });
    // Regra do sono, conferida a cada segundo
    setInterval(() => this.verificarSono(), 1000);
    // Olhar: um laço por quadro (barato: sem cursor novo, nada é escrito)
    let antes = performance.now();
    const quadro = (agora) => {
      const dt = Math.min(100, agora - antes); antes = agora;
      for (const c of this.cats) c.atualizarOlhar(dt, this.reduzirMovimento);
      this._quadro = requestAnimationFrame(quadro);
    };
    this._quadro = requestAnimationFrame(quadro);
  },

  setCount(n) {
    n = Math.max(0, Math.min(2, Number(n) || 0));
    if (n === this.count) return;
    this.count = n;
    this.cats.forEach((c) => c.destroy());
    this.cats = [];
    for (let i = 0; i < n; i++) this.cats.push(new Cat(this.host, i));
    // Pré-carrega todos os GIFs de cada gato: a primeira troca de estado não
    // pisca um quadro vazio enquanto o arquivo carrega
    const nomes = [...new Set(Object.values(CAT_GIF))];
    for (let i = 0; i < n; i++) for (const nome of nomes) resolveSprite(i, nome);
    this.atribuir();
    // Todo gato que aparece cumprimenta ("oi!") e depois vai ao estado-base
    this.cats.forEach((c) => c.reagir("greeting", T_OLA));
    this.ajustarFrequencia();
  },

  // Resumo do agente vindo do main: { estado, sessoes: [{id, state, ...}], ultimoEvento }
  setAgente(resumo) {
    if (!resumo) return;
    this.sessoes = Array.isArray(resumo.sessoes) ? resumo.sessoes : [];
    if (resumo.ultimoEvento) this.ultimoEvento = Math.max(this.ultimoEvento, resumo.ultimoEvento);
    this.atribuir();
    this.ajustarFrequencia();
  },

  // Um gato por sessão, de forma ESTÁVEL: o gato segue a sua sessão enquanto ela
  // existir; só troca por outra sessão estritamente mais urgente (ex.: um pedido
  // de aprovação "rouba" o gato de uma sessão que só está trabalhando).
  atribuir() {
    const porId = new Map(this.sessoes.map((s) => [s.id, s]));
    const nivel = (id) => (porId.has(id) ? NIVEL[porId.get(id).state] ?? 4 : 9);
    for (const c of this.cats) if (c.sessao && !porId.has(c.sessao)) c.sessao = null;
    for (const s of this.sessoes) {                      // já vêm da mais urgente para a mais calma
      if (this.cats.some((c) => c.sessao === s.id)) continue;
      const livre = this.cats.find((c) => !c.sessao);
      if (livre) { livre.sessao = s.id; continue; }
      const menosUrgente = [...this.cats].sort((a, b) => nivel(b.sessao) - nivel(a.sessao))[0];
      if (menosUrgente && NIVEL[s.state] < nivel(menosUrgente.sessao)) menosUrgente.sessao = s.id;
    }
    for (const c of this.cats) {
      const s = c.sessao && porId.get(c.sessao);
      c.setAgente(s ? AGENTE_PARA_GATO[s.state] || null : null);
    }
  },

  verificarSono() {
    const parado = Date.now() - this.ultimoEvento >= SONO_APOS;
    for (const c of this.cats) c.avaliarSono(parado);
    this.ajustarFrequencia();
  },

  // ~30 amostras/s com algum gato acordado (a cabeça acompanha o cursor a cada
  // quadro); 10/s com todos dormindo
  ajustarFrequencia() {
    const acordado = this.cats.some((c) => c.state !== "sleeping");
    const hz = acordado ? 30 : 10;
    if (hz !== this.frequencia && this.pedirFrequencia) { this.frequencia = hz; this.pedirFrequencia(hz); }
  },

  setCursor(p) {
    if (!p) return;
    this.ultimoMovimento = performance.now();
    for (const c of this.cats) c.onCursor(p);
  },
};

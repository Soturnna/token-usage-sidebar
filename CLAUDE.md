# token-usage-sidebar — contexto do projeto

Barra lateral de desktop (Electron, Windows) que mostra o consumo da conta do
Claude: janelas de 5h (sessão) e 7 dias (semanal). Fica ancorada à direita da
tela como dois medidores circulares; ao passar o mouse, expande um painel.
Projeto open source do Marcos (GitHub: **Soturnna/token-usage-sidebar**).

> Idioma: responder sempre em PT-BR. Comentários do código em português.
> Não fazer commit nem push sem o Marcos pedir.

## Como rodar e empacotar

```
npm install
npm start          # modo desenvolvimento
npm run dist       # gera dist/token-usage-sidebar.exe (portátil, arquivo único)
```

O build portátil usa `win.signAndEditExecutable: false` (evita a dependência do
`winCodeSign`, que falha no Windows sem Modo de Desenvolvedor por causa de
symlinks). Em troca, o ícone do .exe é o padrão do Electron; o ícone da bandeja,
em runtime, vem de `assets/icon.png`.

## Arquitetura

```
src/
  main.js            processo principal: janelas, bandeja, config, IPC, agente
  usage.js           lê o histórico local (%APPDATA%\Claude\plan-usage-history.json)
  live.js            lê o uso "ao vivo" (token OAuth em texto + endpoint oauth/usage)
  agent-pipe.js      copia o relay p/ pasta estável + servidor do named pipe
  agent-state.js     agregador PURO evento de hook -> estado por sessão (testável)
  hooks-install.js   prévia (diff) / gravação com backup no ~/.claude/settings.json
  preload.js         ponte segura da barra (contextBridge)
  preload-panel.js   ponte segura do painel de controle
  make-icon.js       gera o ícone da bandeja (normal e com selo de alerta)
relay/tus-relay.cs   relay C# dos hooks (compilado por scripts/build-relay.js)
scripts/simular-eventos.js   cenários de teste pelo caminho real (relay -> pipe)
test/                testes sem dependências (npm test)
  renderer/
    index.html / renderer.js / styles.css   barra + pílula + painel hover
    panel.html / panel.js / panel.css        janela de painel de controle
    cats.js                                   pets virtuais (gatinhos)
```

Config persistida em `app.getPath("userData")/config.json`. `DEFAULTS` em
`main.js` define as chaves (incluindo `cats`). Fluxo de config: renderer chama
`panelApi.setConfig(patch)` → `ipcMain.handle("set-config")` → salva, chama
`enviarConfig()` (envia "config" para barra e painel) e `tick()`.

### Dados (híbrido)
Fontes dos gauges: statusLine do Claude Code (opcional, empurrada pelo relay a
cada resposta, sem rede) e endpoint oficial (`live.js`, token de
`~/.claude/.credentials.json`); entre as duas vence a leitura MAIS RECENTE
(`resolveUsage` em main.js). Reserva: histórico local de `usage.js`.
`enviarUso()` recalcula sem rede (usado a cada statusLine; não chamar `tick()`
ali, ele consulta o endpoint). **Importante:** os caminhos são resolvidos via
`os.homedir()` (não por `process.env.APPDATA/USERPROFILE`), porque o lançador
do .exe portátil às vezes não repassa essas variáveis.

### Eventos do Claude Code (hooks -> named pipe) — substituiu o fs.watch
O fs.watch nos .jsonl foi REMOVIDO: o .jsonl só é gravado quando uma mensagem
termina, então "silêncio = terminou" falhava (17% das pausas reais dentro de um
turno passavam de 6 s; máx. medido 163 s). Agora:
`Claude Code -> hook (forma exec: command + args) -> tus-relay.exe hook ->
\\.\pipe\token-usage-sidebar-<usuário> -> agent-pipe.js -> agent-state.js -> IPC "agent"`.
- Relay em C# 5 compilado com o csc.exe do .NET Framework 4 (existe em todo
  Windows; ~150–250 ms por evento). NUNCA bloqueia: pipe inexistente = sai na
  hora; Connect 300 ms; processo limitado a 800 ms; exit 0; nada no stdout.
  Só repassa campos de uma lista fixa (sem prompts/comandos/arquivos).
- O .exe portátil se extrai em pasta temporária diferente a cada execução, por
  isso o relay é copiado para `~/AppData/Local/token-usage-sidebar/bin/` junto
  com `relay.json` (pipe, token, statusLine anterior). Mensagens sem o token são
  descartadas.
- Mapeamento e vigias em agent-state.js (testes em test/agent-state.test.js).
  O `Stop` não dispara em interrupção (Esc): quem devolve ao ocioso é a
  `Notification idle_prompt`; vigia de 10 min sem evento como último recurso.
- Instalação pelo painel de controle: prévia (diff) -> "Aplicar" -> backup
  `settings.json.bak-AAAAMMDD-HHMMSS` + gravação atômica; a gravação recusa se o
  arquivo mudou desde a prévia. Entradas nossas = comando contém "tus-relay".
- Testar sem cota: `node scripts/simular-eventos.js <cenário>` (com o app aberto).

## Feature atual: pets virtuais (gatinhos) — NÃO COMMITADA

Toda a feature está no working tree, ainda sem commit (aguardando aval do
Marcos), incluindo a integração por hooks. Há também um `main.js` solto na
RAIZ do projeto que NÃO faz parte do app (cópia antiga; apagar com aval).

### Máquina de estados (em `src/renderer/cats.js`)

```
(início / gato novo) greeting "oi!" --(1,8 s)--> [base]
[base] = estado de poleiro pedido pelo agente, ou [ocioso]
poleiro (topo da barra): thinking "…" | working | alert "!" | asking "?" |
                         finished | error | ratelimit (ampulheta)
poleiro --(sessão ociosa)--> descending --> kneading --> idle
[ocioso] = idle (sentado; cabeça segue o cursor) | licking | playing (sorteio)
           sleeping SÓ com 2 min sem evento do agente E cursor > 150 px,
           passando antes por kneading (se ajeita); cursor perto acorda
           após 300–800 ms; carinho exige 350 ms de hover parado
[ocioso] --(mouse perto)--> stalking --> pouncing --> swatting (caça)
[ocioso] <--(hover)--> petting
clique: angry 800 ms | 3 cliques em 1,7 s: dizzy 3,3 s | depois -> [base]
        (ignorado em alert/asking; alert/asking interrompem reações)
```

- Um gato por sessão (`CatPets.atribuir`), de forma estável: o gato só troca
  para uma sessão estritamente mais urgente (`NIVEL`; working = thinking).
- `working`: gato no topo da barra, digitando no PC.
- `descending`: desce até a roda (850 ms).
- `kneading`: "amassa pãozinho" (2,2 s), depois `idle`.
- Ócio (tabela `OCIOSO`: peso + duração min/max): `idle` (peso 5, 15–40 s),
  `licking` (peso 2, 6–10 s), `playing` (peso 2, 7–12 s; a roda ganha a classe
  `is-batted` e balança como um novelo), `sleeping` (peso 0: nunca sorteado).
  `sortearOcioso(evitar)` nunca repete o comportamento atual.
- Olhar: `atualizarOlhar` (rAF) calcula `tanh(dx/260)`/`tanh(dy/200)`,
  suaviza e escreve `--olhar-x/--olhar-y`; o CSS de `.is-idle` inclina o corpo.
  Os GIFs não têm olhos separáveis: por isso é a cabeça/corpo que segue.
- Balões, estrelas e marca de raiva são SVG em código (`BALAO_CONTEUDO`,
  `CAT_FX_*`). Calibração (800 ms, 3/1,7 s, 3,3 s, 2 min) inspirada na spec do
  Coucou (MIT); nada de arte/nome/som do Mochi.
- Caça (felino com presa, inspirada no padrão Crouch → Jump → Attack_swat do
  Sill Cats — só a ideia; nenhum código/asset do jogo foi copiado):
  `stalking` foca no cursor (espelha via `is-flip`), rebaixa a postura e depois
  se arma (`is-armed`, rebolado) → `pouncing` = salto em arco (Web Animations
  no `.cat`, alcance limitado por `CACA.boteMax*` e pela borda da janela) →
  `swatting` = patada → rearma se a presa segue perto, senão volta ao ócio.
  `interesse` (2–3 botes) cai a cada bote e é renovado quando o cursor se
  mexe: presa parada perde a graça. Raios `CACA.perto`/`longe` = histerese.
  Tempos sorteados em `T_CACA`. NÃO usar loop de "tranco" (parecia latido).
- `petting` (hover): GIF de dormir + ronronar + corações/nota musical.
- `angry` (clique): agachado e emburrado (GIF calmo, 200 ms/quadro).

Classe `Cat` = um gato; objeto `CatPets` = gerenciador (`init`, `setCount`,
`setAgente`, `setCursor`). Gato 0 (ruivo) dorme na roda 5h; gato 1 (cinza) na 7d — ver
`CAT_HOME`. Quantidade configurável (0/1/2) no painel.

### Três pontos delicados de posicionamento
1. **`#pill` tem `clip-path`**, que recorta tudo dentro dele. Por isso os gatos
   vivem numa camada IRMÃ `#cats` (ver index.html / styles.css), com
   `pointer-events:none` (só os gatos recebem clique).
2. **A posição é medida em runtime** com `getBoundingClientRect()`
   (`ringAnchors` e `place()`), nunca cravada, e aplicada via `right` (não
   `left`): a barra é ancorada à direita (a janela hoje tem largura fixa, mas a
   regra continua valendo se ela mudar). A `transition` de posição só existe em
   `.is-descending`; fora da descida o gato reposiciona sem animar.
3. **Área de hover/clique** é a `.cat-hit` (só o corpo do gato, com `inset` em %
   por estado, medido na área opaca dos GIFs). O `.cat` em si tem
   `pointer-events:none`. `hovered` é lembrado entre estados: se o mouse já está
   em cima quando o gato deita, ele entra direto em `petting`.

### Gatilho de "trabalhando"
Ver "Eventos do Claude Code (hooks -> named pipe)" acima. O IPC "agent" leva
`{ estado, sessoes[], ultimoEvento, conectado }` à barra (gatos + linha de
estado no painel de hover) e ao painel; a bandeja mostra o estado no tooltip e
ganha um selo no ícone em approval/question.

### Posição do cursor (caça ao mouse e olhar)
A janela da barra tem 94 px: o renderer não recebe eventos de mouse fora dela.
`observarCursor()` (main.js) lê `screen.getCursorScreenPoint()` e envia pelo
IPC "cursor" só quando muda (e só se houver gatos). Frequência pedida pelo
renderer via "cursor-hz": 30 Hz com gato acordado, 10 Hz com todos dormindo.
O renderer converte com `window.screenX/screenY`.

### Layout
Janela de tamanho FIXO 424 × 456 (`JANELA` em main.js): nada é redimensionado
no hover. Fora da pílula, do painel aberto e dos gatos, os cliques atravessam
(`setIgnoreMouseEvents(true, { forward: true })`, alternado pelo renderer via
"set-interactive" com `elementFromPoint`). Abrir/fechar o painel = classe
`collapsed` (90 ms de intenção para abrir, 260 ms de tolerância para fechar);
o painel fechado usa `visibility` com atraso, então sai animado e nunca muda o
layout. O cursor global (sempre amostrado) fecha o painel se sair da janela. Rótulos 5h/7d
ficam DENTRO das rodas e o gap entre rodas é 30 px: o gato sentado na roda de
baixo não cobre texto. Regras das skills aplicadas: aria-label/role nos
gauges e botões de ícone, foco visível, `prefers-reduced-motion`, sem brilho
nem gradiente decorativo (lint do design-taste-frontend: 0 FAIL).

### Arte (GIFs de pixel art)
GIFs gerados no PixelLab, em `assets/cats/`. Cada estado troca o `src` do
`<img>` do gato (mapa `CAT_GIF` em `cats.js`):
`cat_working`, `cat_descending`, `cat_kneading`, `cat_sleeping`, `cat_angry`,
e (a gerar) `cat_licking`, `cat_playing`, `cat_crouch`, `cat_pounce`,
`cat_swat`. Enquanto um GIF não existir, `CAT_GIF_RESERVA` usa outro
(licking/playing → kneading; crouch → angry; pounce/swat → crouch). A área de clique (`.cat-hit`) segue o GIF realmente exibido
(`data-gif`); GIF novo usa um `inset` padrão até ser medido.
- `petting` reaproveita `cat_sleeping.gif` + corações/nota em SVG por cima
  (único efeito ainda desenhado em código).
- Gato 2 procura `cat2_<estado>.gif`; se um arquivo não existir, usa o do
  gato 1 com `filter: grayscale(100%)` (classe `is-gray`). A checagem é feita
  por estado, então dá para ir adicionando os `cat2_` aos poucos.
- Tamanho: `CAT_ESCALA` (× `CAT_BASE` = 56 px) define o lado do gato e escala
  os deslocamentos de `OFFSET_BASE`. O JS injeta `--cat-size` e
  `--cat-descend` (= `T_DESCEND`) no CSS — não cravar esses valores no CSS.
- Pixel art fica mais nítida quando o tamanho final é múltiplo do canvas do
  GIF (68 px). Escala 1.25 → 70 px, quase 1:1.

## Estado de publicação
- Último release publicado: **v1.1.0** (botão "Abrir Claude"). Intacto.
- A feature dos gatos ainda não foi commitada nem publicada. Quando o Marcos
  aprovar: commit, bump para v1.2.0 em `package.json`, `npm run dist`, e
  `gh release create` com o .exe.

## Testar a feature sem gastar cota
`npm test` (agregador + instalador, sem Electron). Com o app aberto
(`npm start`; feche antes o .exe v1.1.0, senão o bloqueio de instância única
encerra a cópia de desenvolvimento): `node scripts/simular-eventos.js
<turno|pausa90|aprovacao|pergunta|erro|limite|esc|sessoes|statusline>`.
O sandbox do Claude Code bloqueia a criação de named pipes: o teste de ponta a
ponta precisa rodar fora dele (o Marcos roda com `!` ou num terminal).

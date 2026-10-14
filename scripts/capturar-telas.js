// Ferramenta de desenvolvimento: abre o app, força cada estado dos gatos e do
// painel e salva uma captura PNG de cada um (de DENTRO do Electron: janelas
// transparentes não aparecem em capturas de tela feitas por fora no Windows).
//
//   npx electron scripts/capturar-telas.js <pasta-de-saída>
//
// Roda com outro nome de app ("Electron"), então não usa nem altera a sua
// config.json. Feche o app antes, senão o pipe de eventos já estará em uso.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const pasta = path.resolve(process.argv[2] || "capturas");
fs.mkdirSync(pasta, { recursive: true });
// Pasta de dados própria: config limpa e nenhuma disputa de "instância única"
app.setPath("userData", path.join(pasta, "dados"));

app.on("browser-window-created", (_e, win) => {
  win.webContents.on("did-finish-load", async () => {
    if (!win.webContents.getURL().endsWith("index.html")) return;   // só a barra
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const js = (codigo) => win.webContents.executeJavaScript(codigo);
    const foto = async (nome) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(pasta, nome + ".png"), img.toPNG());
      console.log("captura:", nome);
    };
    const agente = (estado) => js(`CatPets.setAgente({ sessoes: ${estado ? `[{ id: "s", state: "${estado}" }]` : "[]"}, ultimoEvento: Date.now() })`);

    try {
      await esperar(900);   await foto("01-oi");
      await esperar(1600);  await foto("02-ocioso-sentado");
      for (const [i, estado] of ["thinking", "working", "approval", "question", "finished", "error", "ratelimit"].entries()) {
        await agente(estado); await esperar(700); await foto(`${String(3 + i).padStart(2, "0")}-${estado}`);
      }
      await agente(null);   await esperar(3600); await foto("10-voltou-ao-ocioso");
      await js("CatPets.cats[0].poke()"); await esperar(150); await foto("11-irritado");
      await esperar(1000);
      await js("const c = CatPets.cats[0]; c.poke(); c.poke(); c.poke();"); await esperar(500); await foto("12-tonto");
      await esperar(3400);
      await js("CatPets.cats[0].set('sleeping')"); await esperar(500); await foto("13-dormindo");
      await js("CatPets.cats[0].hovered = true; CatPets.cats[0].pet()"); await esperar(500); await foto("14-carinho");
      await js("CatPets.cats[0].hovered = false; CatPets.cats[0].pet()");
      await js("document.getElementById('app').classList.remove('collapsed')"); await esperar(450); await foto("15-painel-aberto");
      await js("CatPets.setCount(2)"); await esperar(2600); await foto("16-dois-gatos");
      // Ponta a ponta: um pedido de permissão REAL pelo relay instalado -> pipe -> app
      await js("document.getElementById('app').classList.add('collapsed'); CatPets.setCount(1)");
      await esperar(2200);
      const relay = require("../src/agent-pipe").caminhoRelay();
      const envio = (ev) => require("child_process").spawnSync(relay, ["hook"], {
        input: JSON.stringify({ session_id: "e2e", cwd: "C:\\projetos\\e2e", ...ev }),
      });
      const r = envio({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
      console.log("relay -> exit", r.status, "stdout:", JSON.stringify(String(r.stdout)));
      await esperar(900); await foto("17-e2e-aprovacao-pelo-pipe");
      envio({ hook_event_name: "SessionEnd" });
    } catch (e) {
      console.error("falha na captura:", e);
    }
    app.exit(0);
  });
});

require("../src/main.js");

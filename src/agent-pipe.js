// Ponte entre os hooks do Claude Code e o app: prepara o relay e escuta o
// NAMED PIPE do Windows por onde ele manda os eventos.
//
// Fluxo:  Claude Code -> hook -> tus-relay.exe -> \\.\pipe\token-usage-sidebar-<usuário> -> aqui
//
// O .exe portátil se extrai numa pasta temporária DIFERENTE a cada execução,
// então o settings.json não pode apontar para dentro dele. Por isso o relay é
// copiado para uma pasta estável do usuário (pastaBase()/bin), junto com o
// relay.json (nome do pipe + token), que é lido pelo próprio relay.
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MAX_LINHA = 64 * 1024;   // o relay só manda campos curtos; acima disto é lixo

// %LOCALAPPDATA%\token-usage-sidebar, resolvido via os.homedir() (o lançador
// do .exe portátil às vezes não repassa as variáveis de ambiente).
function pastaBase() {
  return path.join(os.homedir(), "AppData", "Local", "token-usage-sidebar");
}
function pastaRelay() { return path.join(pastaBase(), "bin"); }
function caminhoRelay() { return path.join(pastaRelay(), "tus-relay.exe"); }
function caminhoConfig() { return path.join(pastaRelay(), "relay.json"); }

// Um pipe por usuário do Windows (o espaço de nomes de pipes é da máquina toda)
function nomeDoPipe() {
  let usuario = "usuario";
  try { usuario = os.userInfo().username; } catch { /* mantém o padrão */ }
  return "token-usage-sidebar-" + usuario.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function lerConfigRelay() {
  try { return JSON.parse(fs.readFileSync(caminhoConfig(), "utf8")); } catch { return {}; }
}

function gravarConfigRelay(cfg) {
  fs.mkdirSync(pastaRelay(), { recursive: true });
  const tmp = caminhoConfig() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, caminhoConfig());
}

// Junta campos ao relay.json (ex.: a statusLine anterior do usuário)
function atualizarConfigRelay(patch) {
  const cfg = { ...lerConfigRelay(), ...patch };
  for (const k of Object.keys(cfg)) if (cfg[k] == null) delete cfg[k];
  gravarConfigRelay(cfg);
  return cfg;
}

// Copia o relay embutido no app para a pasta estável (se mudou) e garante o
// relay.json com o nome do pipe e um token secreto (reaproveitado entre execuções).
function prepararRelay(origemExe) {
  const destino = caminhoRelay();
  let ok = false;
  try {
    // readFileSync funciona inclusive de dentro do app.asar empacotado
    const novo = fs.readFileSync(origemExe);
    let atual = null;
    try { atual = fs.readFileSync(destino); } catch { /* ainda não copiado */ }
    if (!atual || !atual.equals(novo)) {
      fs.mkdirSync(pastaRelay(), { recursive: true });
      fs.writeFileSync(destino + ".tmp", novo);
      fs.renameSync(destino + ".tmp", destino);
    }
    ok = true;
  } catch {
    // relay ausente no build ou em uso por um hook neste instante: se já existir
    // uma cópia anterior, ela segue servindo
    ok = fs.existsSync(destino);
  }
  const cfg = lerConfigRelay();
  const token = typeof cfg.token === "string" && cfg.token.length >= 32 ? cfg.token : crypto.randomBytes(24).toString("hex");
  const pipe = nomeDoPipe();
  if (cfg.token !== token || cfg.pipe !== pipe) atualizarConfigRelay({ pipe, token });
  return { ok, exe: destino, pipe, token };
}

// Escuta o pipe. Cada conexão traz UMA linha de JSON. Mensagens sem o token
// certo são descartadas (outro processo não consegue forjar eventos do gato).
function iniciarServidor({ pipe, token, aoReceber, aoErro }) {
  const servidor = net.createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (parte) => {
      buf += parte;
      if (buf.length > MAX_LINHA) sock.destroy();
    });
    sock.on("end", () => {
      const linha = buf.split("\n")[0];
      let msg;
      try { msg = JSON.parse(linha); } catch { return; }
      if (!msg || typeof msg !== "object" || msg.token !== token) return;
      delete msg.token;
      try { aoReceber(msg); } catch { /* um evento ruim não derruba o servidor */ }
    });
    sock.on("error", () => { /* relay desistiu no meio: ignora */ });
  });
  servidor.on("error", (e) => aoErro && aoErro(e));
  servidor.listen("\\\\.\\pipe\\" + pipe);
  return servidor;
}

module.exports = {
  pastaBase, caminhoRelay, nomeDoPipe, prepararRelay, iniciarServidor,
  lerConfigRelay, atualizarConfigRelay,
};

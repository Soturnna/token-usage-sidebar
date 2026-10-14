// Compila o relay dos hooks (relay/tus-relay.cs -> assets/relay/tus-relay.exe)
// com o compilador C# que já vem em todo Windows 10/11 (.NET Framework 4).
// Assim o projeto não precisa de nenhum toolchain extra (nada de Rust, nada
// de instalar o SDK do .NET). Roda sozinho antes do `npm start` e do `npm run dist`.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const raiz = path.join(__dirname, "..");
const fonte = path.join(raiz, "relay", "tus-relay.cs");
const destino = path.join(raiz, "assets", "relay", "tus-relay.exe");

if (process.platform !== "win32") {
  console.log("[relay] não é Windows: compilação ignorada");
  process.exit(0);
}

// Já está atualizado? (o .exe é mais novo que o código-fonte)
try {
  if (fs.statSync(destino).mtimeMs >= fs.statSync(fonte).mtimeMs) process.exit(0);
} catch { /* ainda não existe: compila */ }

const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
const csc = ["Framework64", "Framework"]
  .map((f) => path.join(windir, "Microsoft.NET", f, "v4.0.30319", "csc.exe"))
  .find((p) => fs.existsSync(p));
if (!csc) {
  console.error("[relay] csc.exe do .NET Framework 4 não encontrado; os hooks ficarão indisponíveis");
  process.exit(1);
}

fs.mkdirSync(path.dirname(destino), { recursive: true });
execFileSync(csc, [
  "-nologo", "-optimize", "-target:exe",
  "-r:System.Web.Extensions.dll",       // JavaScriptSerializer (leitura do JSON do hook)
  "-out:" + destino, fonte,
], { stdio: "inherit" });
console.log("[relay] compilado:", path.relative(raiz, destino));

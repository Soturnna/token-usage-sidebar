// tus-relay — repassa os eventos dos hooks do Claude Code ao token-usage-sidebar
// por um NAMED PIPE do Windows (\\.\pipe\<nome>), como uma linha de JSON.
//
// A ideia de um relay "que nunca trava o agente" vem do projeto Coucou, de
// Louis Raillé (licença MIT). Este código é original, escrito para este app.
//
// Modos:
//   tus-relay.exe [hook]       chamado pelos hooks (SessionStart, PreToolUse...)
//   tus-relay.exe statusline   chamado como statusLine: repassa os limites de uso
//
// Regras de ouro (o Claude Code NUNCA pode esperar por nós):
//   * pipe inexistente (app fechado) -> sai na hora, código 0, sem escrever nada;
//   * conexão limitada a 300 ms e o processo inteiro a um orçamento fixo;
//   * no modo hook, NUNCA escreve no stdout: não opinamos em permissões.
//   * só campos de uma lista fixa saem daqui: prompts, comandos e conteúdo de
//     arquivos nunca chegam ao app.
//
// Compilado pelo compilador C# que já vem no Windows (.NET Framework 4):
// ver scripts/build-relay.js. Por isso a sintaxe é a do C# 5 (sem $"", sem ?.).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Relay
{
    const int CONECTAR_MS = 300;          // espera máxima pela conexão do pipe
    const int ORCAMENTO_HOOK_MS = 800;    // vida máxima do processo no modo hook
    const int ORCAMENTO_STATUS_MS = 6000; // vida máxima no modo statusline
    const int STATUS_ANTERIOR_MS = 5000;  // tempo dado à statusLine antiga do usuário
    const int MAX_SAIDA = 64 * 1024;      // o que guardamos da saída da statusLine antiga

    // Campos repassados ao app. Todo o resto do payload fica para trás.
    static readonly string[] CAMPOS = {
        "hook_event_name", "session_id", "tool_name", "notification_type",
        "error", "reason", "source", "agent_id"
    };

    static int Main(string[] args)
    {
        bool modoStatus = args.Length > 0 && args[0] == "statusline";
        int orcamento = modoStatus ? ORCAMENTO_STATUS_MS : ORCAMENTO_HOOK_MS;
        // O trabalho roda numa thread de fundo; se estourar o orçamento, o
        // processo sai mesmo assim (threads de fundo morrem com ele).
        var t = new Thread(() => { try { if (modoStatus) StatusLine(); else Hook(); } catch { } });
        t.IsBackground = true;
        t.Start();
        t.Join(orcamento);
        return 0;
    }

    // ----- modo hook -----
    static void Hook()
    {
        string corpo = LerStdin();              // lê sempre: o Claude Code espera que o stdin seja consumido
        var cfg = LerConfig();
        if (cfg == null || !PipeExiste(cfg.Pipe)) return;
        var js = NovoSerializador();
        var entrada = js.DeserializeObject(corpo) as Dictionary<string, object>;
        if (entrada == null) return;

        var saida = new Dictionary<string, object>();
        foreach (var campo in CAMPOS)
        {
            object v;
            if (entrada.TryGetValue(campo, out v) && v is string) saida[campo] = Cortar((string)v, 200);
        }
        // Só o NOME da pasta do projeto (para o painel), nunca o caminho inteiro
        object cwd;
        if (entrada.TryGetValue("cwd", out cwd) && cwd is string)
            saida["project"] = Cortar(NomeDaPasta((string)cwd), 80);
        // A mensagem da Notification serve para reconhecer "limite de uso"
        object msg;
        if (Igual(entrada, "hook_event_name", "Notification") && entrada.TryGetValue("message", out msg) && msg is string)
            saida["message"] = Cortar((string)msg, 160);

        saida["kind"] = "hook";
        saida["t"] = AgoraMs();
        saida["token"] = cfg.Token;
        Enviar(cfg.Pipe, js.Serialize(saida));
    }

    // ----- modo statusline -----
    static void StatusLine()
    {
        string corpo = LerStdin();
        var cfg = LerConfig();
        var js = NovoSerializador();
        Dictionary<string, object> entrada = null;
        try { entrada = js.DeserializeObject(corpo) as Dictionary<string, object>; } catch { }

        // 1. Repassa os limites ao app em paralelo (fire-and-forget)
        Thread envio = null;
        if (cfg != null && entrada != null)
        {
            var limites = Limites(entrada);
            if (limites != null && PipeExiste(cfg.Pipe))
            {
                var saida = new Dictionary<string, object>();
                saida["kind"] = "statusline";
                saida["t"] = AgoraMs();
                saida["token"] = cfg.Token;
                saida["rate_limits"] = limites;
                string linha = js.Serialize(saida);
                envio = new Thread(() => { try { Enviar(cfg.Pipe, linha); } catch { } });
                envio.IsBackground = true;
                envio.Start();
            }
        }

        // 2. O texto da barra: a statusLine que o usuário já tinha, ou a nossa
        string texto = null;
        if (cfg != null && !string.IsNullOrEmpty(cfg.Anterior)) texto = RodarAnterior(cfg.Anterior, corpo);
        if (texto == null) texto = TextoProprio(entrada);
        Escrever(texto);

        if (envio != null) envio.Join(CONECTAR_MS + 200);
    }

    // Copia só five_hour / seven_day { used_percentage, resets_at }
    static Dictionary<string, object> Limites(Dictionary<string, object> entrada)
    {
        object rl;
        if (!entrada.TryGetValue("rate_limits", out rl)) return null;
        var mapa = rl as Dictionary<string, object>;
        if (mapa == null) return null;
        var saida = new Dictionary<string, object>();
        foreach (var janela in new[] { "five_hour", "seven_day" })
        {
            object j;
            if (!mapa.TryGetValue(janela, out j)) continue;
            var dj = j as Dictionary<string, object>;
            if (dj == null) continue;
            var copia = new Dictionary<string, object>();
            object v;
            if (dj.TryGetValue("used_percentage", out v)) copia["used_percentage"] = v;
            if (dj.TryGetValue("resets_at", out v)) copia["resets_at"] = v;
            saida[janela] = copia;
        }
        return saida.Count > 0 ? saida : null;
    }

    // Nossa linha: "Opus · 5h 23% · 7d 41%" (o que existir)
    static string TextoProprio(Dictionary<string, object> entrada)
    {
        if (entrada == null) return "";
        var partes = new List<string>();
        object m;
        if (entrada.TryGetValue("model", out m) && m is Dictionary<string, object>)
        {
            object nome;
            if (((Dictionary<string, object>)m).TryGetValue("display_name", out nome) && nome is string)
                partes.Add((string)nome);
        }
        var limites = Limites(entrada);
        if (limites != null)
        {
            if (limites.ContainsKey("five_hour")) partes.Add("5h " + Pct(limites["five_hour"]));
            if (limites.ContainsKey("seven_day")) partes.Add("7d " + Pct(limites["seven_day"]));
        }
        return string.Join(" \u00b7 ", partes.ToArray());
    }

    static string Pct(object janela)
    {
        var d = janela as Dictionary<string, object>;
        object v;
        if (d == null || !d.TryGetValue("used_percentage", out v) || v == null) return "\u2013";
        try { return Math.Round(Convert.ToDouble(v, CultureInfo.InvariantCulture)).ToString(CultureInfo.InvariantCulture) + "%"; }
        catch { return "\u2013"; }
    }

    // Roda a statusLine anterior do usuário do mesmo jeito que o Claude Code a
    // rodaria no Windows (Git Bash; sem ele, cmd), com o mesmo stdin.
    static string RodarAnterior(string comando, string corpo)
    {
        Process p = null;
        try
        {
            p = IniciarShell("bash.exe", "-c " + Aspas(comando)) ?? IniciarShell("cmd.exe", "/d /s /c \"" + comando + "\"");
            if (p == null) return null;
            var bytes = new UTF8Encoding(false).GetBytes(corpo);
            p.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
            p.StandardInput.Close();
            string saida = null;
            var leitor = new Thread(() => { try { saida = p.StandardOutput.ReadToEnd(); } catch { } });
            leitor.IsBackground = true;
            leitor.Start();
            if (!p.WaitForExit(STATUS_ANTERIOR_MS)) { try { p.Kill(); } catch { } return null; }
            leitor.Join(200);
            if (saida != null && saida.Length > MAX_SAIDA) saida = saida.Substring(0, MAX_SAIDA);
            return saida;
        }
        catch { return null; }
    }

    static Process IniciarShell(string exe, string argumentos)
    {
        try
        {
            var psi = new ProcessStartInfo(exe, argumentos);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            return Process.Start(psi);
        }
        catch { return null; }
    }

    // Aspas no padrão da linha de comando do Windows (barras antes de aspas dobram)
    static string Aspas(string s)
    {
        var sb = new StringBuilder("\"");
        int barras = 0;
        foreach (char c in s)
        {
            if (c == '\\') { barras++; continue; }
            if (c == '"') { sb.Append('\\', barras * 2 + 1); sb.Append('"'); barras = 0; continue; }
            sb.Append('\\', barras); barras = 0; sb.Append(c);
        }
        sb.Append('\\', barras * 2);
        sb.Append('"');
        return sb.ToString();
    }

    // ----- pipe -----
    static bool PipeExiste(string nome)
    {
        // Checagem barata: sem ela, Connect() gastaria os 300 ms inteiros com o app fechado
        try { return File.Exists(@"\\.\pipe\" + nome); } catch { return false; }
    }

    static void Enviar(string nome, string linha)
    {
        using (var pipe = new NamedPipeClientStream(".", nome, PipeDirection.Out))
        {
            pipe.Connect(CONECTAR_MS);
            var bytes = new UTF8Encoding(false).GetBytes(linha + "\n");
            pipe.Write(bytes, 0, bytes.Length);
            pipe.Flush();
        }
    }

    // ----- configuração (relay.json, escrito pelo app ao lado deste .exe) -----
    class Config { public string Pipe; public string Token; public string Anterior; }

    static Config LerConfig()
    {
        try
        {
            string arq = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "relay.json");
            var d = NovoSerializador().DeserializeObject(File.ReadAllText(arq, Encoding.UTF8)) as Dictionary<string, object>;
            if (d == null) return null;
            var c = new Config();
            c.Pipe = Texto(d, "pipe");
            c.Token = Texto(d, "token");
            c.Anterior = Texto(d, "statusLineAnterior");
            return string.IsNullOrEmpty(c.Pipe) ? null : c;
        }
        catch { return null; }
    }

    // ----- utilidades -----
    static JavaScriptSerializer NovoSerializador()
    {
        var js = new JavaScriptSerializer();
        js.MaxJsonLength = int.MaxValue;   // um PostToolUse pode trazer arquivos inteiros
        js.RecursionLimit = 256;
        return js;
    }

    // stdin em bytes + UTF-8 (o Console do .NET usaria a página de código OEM)
    static string LerStdin()
    {
        using (var ms = new MemoryStream())
        {
            Console.OpenStandardInput().CopyTo(ms);
            var b = ms.ToArray();
            int ini = (b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF) ? 3 : 0;   // BOM
            return Encoding.UTF8.GetString(b, ini, b.Length - ini);
        }
    }

    static void Escrever(string texto)
    {
        var bytes = new UTF8Encoding(false).GetBytes(texto ?? "");
        var saida = Console.OpenStandardOutput();
        saida.Write(bytes, 0, bytes.Length);
        saida.Flush();
    }

    static string Texto(Dictionary<string, object> d, string chave)
    {
        object v;
        return d.TryGetValue(chave, out v) ? v as string : null;
    }

    static bool Igual(Dictionary<string, object> d, string chave, string valor)
    {
        return Texto(d, chave) == valor;
    }

    static string NomeDaPasta(string caminho)
    {
        string limpo = caminho.TrimEnd('\\', '/');
        int i = Math.Max(limpo.LastIndexOf('\\'), limpo.LastIndexOf('/'));
        return i >= 0 ? limpo.Substring(i + 1) : limpo;
    }

    static string Cortar(string s, int max)
    {
        return s.Length <= max ? s : s.Substring(0, max) + "\u2026";
    }

    static long AgoraMs()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }
}

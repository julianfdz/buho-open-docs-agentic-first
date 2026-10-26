// buho-docs.exe · cliente nativo del CLI de Búho Docs (Buho Corps Systems).
//
// Con la app abierta, manda el comando a su API local (POST /v1/cli) y la app lo ejecuta por dentro:
// unos milisegundos por comando en vez de arrancar un motor de JavaScript cada vez. La app atiende
// muchas peticiones a la vez (varios agentes trabajando en paralelo).
// Si la app está cerrada, o el comando lee la entrada estándar o va largo (stream, generar), pasa al CLI
// de siempre (buho-docs.mjs con el ejecutable de la app en modo Node), que además abre la app.
//
// Va a pelo (socket y JSON mínimo) a propósito: las librerías de HTTP y JSON de .NET tardan más en
// cargarse que todo el trabajo del comando. Se compila con el csc.exe que trae Windows
// (scripts/build-client.mjs).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

static class BuhoDocsCli
{
    static readonly string Here = AppDomain.CurrentDomain.BaseDirectory;

    static int Main(string[] args)
    {
        string cmd = args.Length > 0 ? args[0] : "";
        bool local = cmd == "" || cmd == "help" || cmd == "--help" || cmd == "skill" || cmd == "stream" || cmd == "generar" || cmd == "atender" || cmd == "torneo" || cmd == "humanizar";
        foreach (string a in args) if (a == "-" || a == "--stdin" || a == "--no-launch") local = true;
        if (!local)
        {
            int code;
            if (TryApp(args, out code)) return code;
        }
        return RunNode(args);
    }

    static string DataDir()
    {
        string env = Environment.GetEnvironmentVariable("BUHO_DATA_DIR");
        if (!string.IsNullOrEmpty(env)) return env;
        string parent = Path.GetFullPath(Path.Combine(Here, ".."));
        if (File.Exists(Path.Combine(parent, "portable.txt"))) return Path.Combine(parent, "datos");
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuhoDocs");
    }

    /** Manda el comando a la app. false si no está abierta (se usará el CLI de Node, que la abre). */
    static bool TryApp(string[] args, out int code)
    {
        code = 1;
        string info = Path.Combine(DataDir(), "api.json");
        if (!File.Exists(info)) return false;
        // api.json: {"url": "http://127.0.0.1:47341", "token": "…", "pid": …}
        string json;
        try { json = File.ReadAllText(info, Encoding.UTF8); }
        catch { return false; }
        string url = Field(json, "url"), token = Field(json, "token");
        if (url == null || token == null) return false;
        int port = int.Parse(url.Substring(url.LastIndexOf(':') + 1).TrimEnd('/'));

        var body = new StringBuilder("{\"argv\":[");
        for (int i = 0; i < args.Length; i++) body.Append(i > 0 ? "," : "").Append(Json.Str(args[i]));
        body.Append("],\"cwd\":").Append(Json.Str(Environment.CurrentDirectory)).Append('}');
        byte[] data = Encoding.UTF8.GetBytes(body.ToString());
        string head = "POST /v1/cli?raw=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer " + token + "\r\nContent-Type: application/json\r\nContent-Length: " + data.Length + "\r\nConnection: close\r\n\r\n";

        byte[] resp;
        try
        {
            using (var tcp = new TcpClient())
            {
                tcp.NoDelay = true;
                tcp.Connect("127.0.0.1", port);
                using (var s = tcp.GetStream())
                {
                    byte[] h = Encoding.ASCII.GetBytes(head);
                    s.Write(h, 0, h.Length);
                    s.Write(data, 0, data.Length);
                    using (var ms = new MemoryStream())
                    {
                        s.CopyTo(ms);
                        resp = ms.ToArray();
                    }
                }
            }
        }
        catch (SocketException) { return false; } // app cerrada
        catch (IOException) { return false; }

        int sep = IndexOf(resp, new byte[] { 13, 10, 13, 10 });
        if (sep < 0) return false;
        string headers = Encoding.ASCII.GetString(resp, 0, sep);
        byte[] raw = new byte[resp.Length - sep - 4];
        Array.Copy(resp, sep + 4, raw, 0, raw.Length);
        if (headers.IndexOf("transfer-encoding: chunked", StringComparison.OrdinalIgnoreCase) >= 0) raw = Dechunk(raw);
        int status = int.Parse(headers.Split(' ')[1]);
        if (status != 200)
        {
            string text = Encoding.UTF8.GetString(raw);
            string err = Field(text, "error");
            Write(Console.OpenStandardError(), "Error: " + (err ?? text) + "\n");
            return true;
        }
        int errBytes = int.Parse(Header(headers, "x-stderr-bytes") ?? "0");
        code = int.Parse(Header(headers, "x-code") ?? "0");
        // Primero los avisos (stderr) y luego el resultado, como al ejecutarlo en la terminal.
        using (var se = Console.OpenStandardError()) se.Write(raw, 0, errBytes);
        using (var so = Console.OpenStandardOutput()) so.Write(raw, errBytes, raw.Length - errBytes);
        return true;
    }

    static string Header(string headers, string name)
    {
        foreach (string l in headers.Split('\n'))
        {
            int c = l.IndexOf(':');
            if (c > 0 && string.Equals(l.Substring(0, c).Trim(), name, StringComparison.OrdinalIgnoreCase)) return l.Substring(c + 1).Trim();
        }
        return null;
    }

    /** Valor de texto de un campo de un JSON plano y sencillo (api.json, mensajes de error). */
    static string Field(string json, string name)
    {
        int k = json.IndexOf("\"" + name + "\"");
        if (k < 0) return null;
        int q = json.IndexOf('"', json.IndexOf(':', k) + 1);
        if (q < 0) return null;
        var sb = new StringBuilder();
        for (int i = q + 1; i < json.Length && json[i] != '"'; i++)
        {
            if (json[i] == '\\' && i + 1 < json.Length) { i++; sb.Append(json[i] == 'n' ? '\n' : json[i]); }
            else sb.Append(json[i]);
        }
        return sb.ToString();
    }

    static int IndexOf(byte[] a, byte[] p)
    {
        for (int i = 0; i + p.Length <= a.Length; i++)
        {
            int k = 0;
            while (k < p.Length && a[i + k] == p[k]) k++;
            if (k == p.Length) return i;
        }
        return -1;
    }

    static byte[] Dechunk(byte[] b)
    {
        var o = new MemoryStream();
        int i = 0;
        while (i < b.Length)
        {
            int nl = IndexOf(Sub(b, i), new byte[] { 13, 10 });
            if (nl < 0) break;
            int size = Convert.ToInt32(Encoding.ASCII.GetString(b, i, nl).Split(';')[0].Trim(), 16);
            if (size == 0) break;
            o.Write(b, i + nl + 2, size);
            i += nl + 2 + size + 2;
        }
        return o.ToArray();
    }

    static byte[] Sub(byte[] b, int from)
    {
        byte[] r = new byte[b.Length - from];
        Array.Copy(b, from, r, 0, r.Length);
        return r;
    }

    static void Write(Stream s, string t)
    {
        if (string.IsNullOrEmpty(t)) return;
        byte[] b = Encoding.UTF8.GetBytes(t);
        s.Write(b, 0, b.Length);
        s.Flush();
    }

    /** CLI de siempre: el ejecutable de la app en modo Node con buho-docs.mjs. */
    static int RunNode(string[] args)
    {
        string exe = Path.GetFullPath(Path.Combine(Here, "..", "BuhoDocs.exe"));
        string mjs = Path.Combine(Here, "buho-docs.mjs");
        if (!File.Exists(exe) || !File.Exists(mjs))
        {
            Write(Console.OpenStandardError(), "No encuentro BuhoDocs.exe junto al CLI. Reinstala Búho Docs.\n");
            return 2;
        }
        var sb = new StringBuilder(Quote(mjs));
        foreach (string a in args) sb.Append(' ').Append(Quote(a));
        var psi = new ProcessStartInfo(exe, sb.ToString()) { UseShellExecute = false };
        psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    /** Comillas de la línea de comandos de Windows (reglas de CommandLineToArgvW). */
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', slashes); sb.Append(c); }
            slashes = 0;
        }
        sb.Append('\\', slashes * 2);
        sb.Append('"');
        return sb.ToString();
    }
}

/** Escapar texto para el JSON de la petición (lo único de JSON que hace falta aquí). */
static class Json
{
    public static string Str(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }
}

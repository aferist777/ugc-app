// UGC Studio's LAUNCHER - the "UGC Studio.exe" a friend opens (phase V83, block B2; the owner 2026-11-09: (о8) "exe",
// (о11а) "у друга только рабочая версия").
//
// The folder it lies in:
//   UGC Studio.exe          this program
//   versions\<version>\     a version of the app (tools/build-app.js); versions\current.json - written only here:
//                           { current, previous, tries, bad[] }
//   updates\                ready.json (the updater: a new version is complete in versions\), started.json (the app: this
//                           version came up), running.json (the app: open, its pid), launcher.log
//   library\                the person's library
//
// What it does, every time, in this order:
//   - "--after <pid>" (the app's own restart): waits until that app is gone, 30 s at most;
//   - the app already open (running.json, its process alive) - starts the same version, which brings the open window
//     up; nothing switched, nothing counted;
//   - ready.json names a complete version that is not `bad` - it becomes current, the one before it `previous`;
//   - current never came up (started.json names another) after two tries and there is a previous one - back to it,
//     the failed one `bad` (the updater never installs it again), and the person told in a window;
//   - starts versions\<current>\UGC Studio.exe with UGC_DATA_DIR = library\, UGC_HOME = this folder,
//     UGC_LAUNCHER = this exe, and leaves.
// The previous version is deleted by the app once the new one came up (desktop/home.js) - a friend keeps one version.
// Compiled by tools/build-app.js with the .NET Framework's own csc.exe - C# 5, nothing to install.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Launcher
{
    const string Exe = "UGC Studio.exe";
    static string Root, Versions, Updates, LogFile, Self;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly Regex VersionName = new Regex(@"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$");

    [STAThread]
    static int Main(string[] args)
    {
        Self = Path.GetFullPath(Application.ExecutablePath);
        Root = Path.GetDirectoryName(Self);
        Versions = Path.Combine(Root, "versions");
        Updates = Path.Combine(Root, "updates");
        LogFile = Path.Combine(Updates, "launcher.log");
        try { Directory.CreateDirectory(Updates); } catch (Exception) { }
        try { return Run(args); }
        catch (Exception e)
        {
            Log("failed: " + e);
            Say("UGC Studio could not start:\n\n" + e.Message, MessageBoxIcon.Error);
            return 1;
        }
    }

    static int Run(string[] args)
    {
        int after = ArgInt(args, "--after");
        if (after > 0) WaitGone(after, 30000);

        Dictionary<string, object> cur = ReadJson(Path.Combine(Versions, "current.json"));
        string current = Name(Str(cur, "current"));
        string previous = Name(Str(cur, "previous"));
        int tries = Int(cur, "tries");
        List<string> bad = Strings(cur, "bad");

        if (!HasExe(current))
        {
            current = Newest(bad);
            tries = 0;
            Log("current.json names no version that is there: taking " + (current ?? "none"));
        }
        if (!HasExe(previous) || previous == current) previous = null;
        if (current == null)
        {
            Say("There is no UGC Studio program in\n\n" + Versions + "\n\nCopy the UGC Studio folder again.", MessageBoxIcon.Error);
            return 1;
        }

        // Already open: its window comes up when the same version is started again (one copy per library).
        Dictionary<string, object> running = ReadJson(Path.Combine(Updates, "running.json"));
        int pid = Int(running, "pid");
        if (pid > 0 && Alive(pid))
        {
            string open = Name(Str(running, "version"));
            if (!HasExe(open)) open = current;
            Log("already open (pid " + pid + ", " + open + "): its window is brought up");
            Start(open);
            return 0;
        }

        // A new version, complete in versions\.
        string ready = Name(Str(ReadJson(Path.Combine(Updates, "ready.json")), "version"));
        if (ready != null && ready != current && HasExe(ready) && !bad.Contains(ready))
        {
            Log("switching " + current + " -> " + ready);
            previous = current;
            current = ready;
            tries = 0;
        }
        if (File.Exists(Path.Combine(Updates, "ready.json")) && (ready == null || ready == current || bad.Contains(ready) || !HasExe(ready)))
            TryDelete(Path.Combine(Updates, "ready.json"));

        // Did the current version ever come up?
        bool came = Name(Str(ReadJson(Path.Combine(Updates, "started.json")), "version")) == current;
        if (came) tries = 0;
        else if (tries >= 2 && previous != null)
        {
            string failed = current;
            Log(failed + " did not come up twice: back to " + previous);
            if (!bad.Contains(failed)) bad.Add(failed);
            current = previous;
            previous = null;
            tries = 0;
            Write(current, previous, tries, bad);
            Say("UGC Studio " + failed + " did not start twice in a row, so UGC Studio went back to " + current + ".\n\n"
                + "That update will not be installed again.", MessageBoxIcon.Warning);
        }

        tries++;
        Write(current, previous, tries, bad);
        Start(current);
        return 0;
    }

    static void Start(string version)
    {
        string exe = Path.Combine(Versions, version, Exe);
        var psi = new ProcessStartInfo(exe);
        psi.WorkingDirectory = Path.GetDirectoryName(exe);
        psi.UseShellExecute = false;
        psi.EnvironmentVariables["UGC_DATA_DIR"] = Path.Combine(Root, "library");
        psi.EnvironmentVariables["UGC_HOME"] = Root;
        psi.EnvironmentVariables["UGC_LAUNCHER"] = Self;
        if (psi.EnvironmentVariables.ContainsKey("ELECTRON_RUN_AS_NODE")) psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        Process.Start(psi);
        Log("started " + version);
    }

    // The newest version folder with its exe that is not bad.
    static string Newest(List<string> bad)
    {
        if (!Directory.Exists(Versions)) return null;
        var names = Directory.GetDirectories(Versions).Select(d => Path.GetFileName(d))
            .Where(n => Name(n) != null && HasExe(n) && !bad.Contains(n)).ToList();
        names.Sort((a, b) => Compare(b, a));
        return names.FirstOrDefault();
    }

    static int Compare(string a, string b)
    {
        Version va, vb;
        bool pa = Version.TryParse(Regex.Replace(a, "[^0-9.].*$", ""), out va);
        bool pb = Version.TryParse(Regex.Replace(b, "[^0-9.].*$", ""), out vb);
        if (pa && pb && va != vb) return va.CompareTo(vb);
        return string.CompareOrdinal(a, b);
    }

    static bool HasExe(string version)
    {
        return version != null && File.Exists(Path.Combine(Versions, version, Exe));
    }

    static string Name(string s)
    {
        return s != null && VersionName.IsMatch(s) ? s : null;
    }

    static bool Alive(int pid)
    {
        try
        {
            Process p = Process.GetProcessById(pid);
            return !p.HasExited && string.Equals(p.ProcessName, "UGC Studio", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception) { return false; }
    }

    static void WaitGone(int pid, int ms)
    {
        try
        {
            Process p = Process.GetProcessById(pid);
            Log("waiting for the app (pid " + pid + ") to close");
            if (!p.WaitForExit(ms)) Log("it is still there after " + (ms / 1000) + " s - going on");
        }
        catch (Exception) { /* gone already */ }
    }

    static void Write(string current, string previous, int tries, List<string> bad)
    {
        var o = new Dictionary<string, object>();
        o["current"] = current;
        o["previous"] = previous;
        o["tries"] = tries;
        o["bad"] = bad.ToArray();
        Directory.CreateDirectory(Versions);
        string file = Path.Combine(Versions, "current.json");
        string tmp = file + ".tmp";
        File.WriteAllText(tmp, Json.Serialize(o), new UTF8Encoding(false));
        if (File.Exists(file)) File.Replace(tmp, file, null);
        else File.Move(tmp, file);
    }

    static Dictionary<string, object> ReadJson(string file)
    {
        try
        {
            if (!File.Exists(file)) return new Dictionary<string, object>();
            string text = File.ReadAllText(file, Encoding.UTF8).TrimStart('﻿');
            var o = Json.DeserializeObject(text) as Dictionary<string, object>;
            return o ?? new Dictionary<string, object>();
        }
        catch (Exception e)
        {
            Log("unreadable " + file + ": " + e.Message);
            return new Dictionary<string, object>();
        }
    }

    static string Str(Dictionary<string, object> o, string key)
    {
        object v;
        return o.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : null;
    }

    static int Int(Dictionary<string, object> o, string key)
    {
        object v;
        if (!o.TryGetValue(key, out v) || v == null) return 0;
        try { return Convert.ToInt32(v); } catch (Exception) { return 0; }
    }

    static List<string> Strings(Dictionary<string, object> o, string key)
    {
        object v;
        var list = new List<string>();
        if (o.TryGetValue(key, out v) && v is IEnumerable && !(v is string))
            foreach (object x in (IEnumerable)v) { string n = Name(Convert.ToString(x)); if (n != null) list.Add(n); }
        return list;
    }

    static int ArgInt(string[] args, string name)
    {
        int i = Array.IndexOf(args, name), n;
        return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out n) ? n : 0;
    }

    static void TryDelete(string file)
    {
        try { File.Delete(file); } catch (Exception) { }
    }

    static void Log(string line)
    {
        try
        {
            var f = new FileInfo(LogFile);
            if (f.Exists && f.Length > 512 * 1024)
            {
                string[] all = File.ReadAllLines(LogFile);
                File.WriteAllLines(LogFile, all.Skip(all.Length / 2));
            }
            File.AppendAllText(LogFile, DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") + " " + line + Environment.NewLine);
        }
        catch (Exception) { }
    }

    static void Say(string text, MessageBoxIcon icon)
    {
        MessageBox.Show(text, "UGC Studio", MessageBoxButtons.OK, icon);
    }
}

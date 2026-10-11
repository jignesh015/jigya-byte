using System;
using System.Diagnostics;
using System.IO;

internal static class BackendLauncher
{
    private static int Main()
    {
        Console.Title = "JigyaByte Backend";
        // Node shares this console and receives Ctrl+C too. Let it close SQLite first.
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
        int exitCode = 1;
        try
        {
            string backend = Path.Combine(LauncherPaths.Project, "backend");
            if (!File.Exists(Path.Combine(backend, "src", "server.ts")))
                throw new Exception("The project has moved. Rebuild the launcher from its new location.");
            if (!File.Exists(Path.Combine(backend, ".env")))
                throw new Exception("backend/.env is missing. Follow the backend setup instructions first.");
            if (!File.Exists(LauncherPaths.Node))
                throw new Exception("Node.js has moved or is missing. Install Node 24.13+ and rebuild the launcher.");
            string script = Path.Combine(LauncherPaths.Project, "scripts", "launch-backend.mjs");
            var start = new ProcessStartInfo(LauncherPaths.Node,
                "--env-file=.env \"" + script + "\"");
            start.WorkingDirectory = backend;
            start.UseShellExecute = false;
            start.CreateNoWindow = false;
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                exitCode = process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
        }
        Console.WriteLine("\nPress Enter to close this window.");
        Console.ReadLine();
        return exitCode;
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32.SafeHandles;
class Launcher {
  static int Main(string[] args) {
    string errorFile = args.Length == 0 ? null : args[0];
    try {
      int pid = Process.GetCurrentProcess().Id;
      using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\iori-host-ready-" + pid))
      using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\iori-host-stop-" + pid)) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), "\"" + Path.Combine(root, "service.mjs") + "\" --launcher");
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardErrorEncoding = System.Text.Encoding.UTF8;
        while (true) {
        ready.Reset();
        using (var child = Process.Start(info)) {
          var errors = child.StandardError.ReadToEndAsync();
          string line;
          while ((line = child.StandardOutput.ReadLine()) != null && line != "ready") { }
          var output = child.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
          if (line == "ready") {
            ready.Set();
            using (var exited = new ManualResetEvent(false)) {
              exited.SafeWaitHandle = new SafeWaitHandle(child.Handle, false);
              if (WaitHandle.WaitAny(new WaitHandle[] { exited, stop }) == 1 && !child.HasExited) {
                child.StandardInput.WriteLine("stop");
                child.StandardInput.Flush();
              }
            }
          }
          child.WaitForExit();
          output.Wait();
          if (child.ExitCode != 0 && errorFile != null) File.WriteAllText(errorFile, errors.Result);
          Console.Error.Write(errors.Result);
          if (child.ExitCode == 75 && !stop.WaitOne(0)) continue;
          return child.ExitCode;
        }
        }
      }
    } catch (Exception error) {
      if (errorFile != null) File.WriteAllText(errorFile, error.Message);
      Console.Error.WriteLine(error.Message);
      return 1;
    }
  }
}

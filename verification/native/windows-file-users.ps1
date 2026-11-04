param([string[]]$Paths)
# Read file users through the Windows Restart Manager API. No shutdown or restart.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
public static class IoriFileUsers {
  [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess {
    public uint Pid; public FILETIME Started;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string Service;
    public int Type; public uint Status; public uint Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint files, string[] paths, uint apps, UniqueProcess[] processes, uint services, string[] names);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] ProcessInfo[] processes, ref uint reasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
  static void Check(int code) { if(code != 0) throw new Win32Exception(code); }
  public static ProcessInfo[] Read(string[] paths) {
    uint handle; Check(RmStartSession(out handle, 0, new StringBuilder(Guid.NewGuid().ToString("N"), 33)));
    try {
      Check(RmRegisterResources(handle, (uint)paths.Length, paths, 0, null, 0, null));
      uint needed, count=0, reasons=0;
      ProcessInfo[] result=null;
      int code=RmGetList(handle, out needed, ref count, result, ref reasons);
      while(code==234) {
        count=needed; result=new ProcessInfo[count];
        code=RmGetList(handle, out needed, ref count, result, ref reasons);
      }
      Check(code);
      if(result==null) return new ProcessInfo[0];
      Array.Resize(ref result, (int)count); return result;
    } finally { Check(RmEndSession(handle)); }
  }
}
'@
$existing = @($Paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($existing.Count) {
  [IoriFileUsers]::Read($existing) | ForEach-Object {
    [pscustomobject]@{
      Id = $_.Process.Pid
      Started = (([long]$_.Process.Started.dwHighDateTime -shl 32) -bor ([long]$_.Process.Started.dwLowDateTime -band 4294967295L))
    }
  }
}

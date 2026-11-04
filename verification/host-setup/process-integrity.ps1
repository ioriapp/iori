param([int[]]$ProcessIds)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class IoriProcessIntegrity {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int length, out int needed);
  public static string Read(int id) {
    IntPtr process=OpenProcess(0x1000,false,id), token=IntPtr.Zero, data=IntPtr.Zero;
    if(process==IntPtr.Zero) throw new Win32Exception();
    try {
      if(!OpenProcessToken(process,0x8,out token)) throw new Win32Exception();
      int needed;
      GetTokenInformation(token,25,IntPtr.Zero,0,out needed);
      data=Marshal.AllocHGlobal(needed);
      if(!GetTokenInformation(token,25,data,needed,out needed)) throw new Win32Exception();
      return new System.Security.Principal.SecurityIdentifier(Marshal.ReadIntPtr(data)).Value;
    } finally {
      if(data!=IntPtr.Zero) Marshal.FreeHGlobal(data);
      if(token!=IntPtr.Zero) CloseHandle(token);
      CloseHandle(process);
    }
  }
}
'@
@($ProcessIds | ForEach-Object {
  $p=Get-Process -Id $_
  @{name=$p.ProcessName;pid=$p.Id;sessionId=$p.SessionId;integrity=[IoriProcessIntegrity]::Read($p.Id)}
}) | ConvertTo-Json -Compress

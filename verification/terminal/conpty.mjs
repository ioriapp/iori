import { windows } from "../native/remote.mjs";

/** Record only the ConPTY file/version loaded by the dedicated verification Host. */
export function loadedWindowsConpty() {
  return JSON.parse(
    windows(
      "$endpoint=Get-NetUDPEndpoint | Where-Object LocalPort -eq 49172 | Select-Object -First 1;$module=(Get-Process -Id $endpoint.OwningProcess).Modules | Where-Object ModuleName -eq 'conpty.dll' | Select-Object -First 1;if($module){@{file=$module.FileName;version=$module.FileVersionInfo.FileVersion} | ConvertTo-Json -Compress}else{'null'}",
    ),
  );
}

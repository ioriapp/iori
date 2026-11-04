import { windows, ps } from "../native/remote.mjs";
import { verificationIdentifier as identifier } from "../config.mjs";
export function prepareWindowsClientStorage(state) {
  const directories = JSON.parse(
    windows(
      `$paths=@([Environment]::GetFolderPath('ApplicationData'),[Environment]::GetFolderPath('LocalApplicationData')) | ForEach-Object {Join-Path $_ ${ps(identifier)}};foreach($path in $paths){$marker=Join-Path $path '.iori-connection-owner';if(Test-Path -LiteralPath $path){if(-not(Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne ${ps(state.id)}){throw 'Verification Client storage is already owned by another run'}}else{[IO.Directory]::CreateDirectory($path) | Out-Null;[IO.File]::WriteAllText($marker,${ps(state.id)})}};ConvertTo-Json -InputObject @($paths) -Compress`,
    ),
  );
  return directories;
}
export function cleanupWindowsClientStorage(state) {
  const result = windows(
    `$paths=@([Environment]::GetFolderPath('ApplicationData'),[Environment]::GetFolderPath('LocalApplicationData')) | ForEach-Object {Join-Path $_ ${ps(identifier)}};foreach($path in $paths){if(Test-Path -LiteralPath $path){$marker=Join-Path $path '.iori-connection-owner';if(-not(Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne ${ps(state.id)}){throw 'Verification Client storage ownership does not match'};cmd.exe /c ('rd /s /q "\\\\?\\'+$path+'"');if(Test-Path -LiteralPath $path){throw 'Verification Client storage remains'}}};'removed'`,
  );
  if (result !== "removed")
    throw new Error("検証Client保存先の回収に失敗しました");
  return true;
}

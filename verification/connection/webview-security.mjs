import { windows, ps } from "../native/remote.mjs";

// Do not retain event XML, account names, SIDs, passwords or process command lines.
export function webViewSecurity(before, after) {
  return JSON.parse(
    windows(`Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction Stop | Out-Null;
$events=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625;StartTime=[DateTime]::Parse(${ps(before)});EndTime=[DateTime]::Parse(${ps(after)})} -ErrorAction SilentlyContinue);
$result=@($events | ForEach-Object {$xml=[xml]$_.ToXml();$fields=@{};foreach($d in $xml.Event.EventData.Data){$fields[$d.Name]=[string]$d.'#text'};if($fields.ProcessName -like '*msedgewebview2*'){@{time=$_.TimeCreated.ToUniversalTime().ToString('o');recordId=$_.RecordId;process=[IO.Path]::GetFileName($fields.ProcessName);processId=$fields.ProcessId;status=$fields.Status;subStatus=$fields.SubStatus;logonType=$fields.LogonType;authenticationPackage=$fields.AuthenticationPackageName;logonProcess=$fields.LogonProcessName;localOnly=($fields.IpAddress -in @('-','127.0.0.1','::1'));targetIsCurrentUser=($fields.TargetUserName -eq $env:USERNAME);targetIsLocalDomain=($fields.TargetDomainName -eq $env:COMPUTERNAME)}}});ConvertTo-Json -InputObject $result -Compress`),
  );
}

import { windows, ps } from "./remote.mjs";

/** Read the three Windows rule/filter collections once. Querying CIM for each
 * rule takes minutes on a machine with many installed applications. */
export function windowsFirewallBaseline(ruleName) {
  return JSON.parse(
    windows(`
$rules=@(Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow)
$applications=@{};Get-NetFirewallApplicationFilter | ForEach-Object {$applications[$_.InstanceID]=$_}
$ports=@{};Get-NetFirewallPortFilter | ForEach-Object {$ports[$_.InstanceID]=$_}
$unmatched=0
$candidates=@($rules | ForEach-Object {
  $r=$_;$a=$applications[$r.Name];$p=$ports[$r.Name]
  if(-not $a -or -not $p){$unmatched++}
  elseif($a.Program -eq 'Any' -or $a.Program -like '*node.exe') {
    @{name=$r.DisplayName;packageScoped=([bool]$r.PackageFamilyName -or ($a.Package -and $a.Package -ne 'Any'));profile=[string]$r.Profile;program=$a.Program;protocol=[string]$p.Protocol;ports=[string]$p.LocalPort}
  }
})
@{profiles=@(Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory);rules=$candidates;unmatched=$unmatched;testRuleCount=@(Get-NetFirewallRule -Name ${ps(ruleName)} -ErrorAction SilentlyContinue).Count} | ConvertTo-Json -Depth 5 -Compress
`),
  );
}

/** Remove only rules tied to the caller's dedicated verification program. */
export function removeWindowsProgramRules(program) {
  return JSON.parse(
    windows(`
$program=${ps(program)}
$filters=@(Get-NetFirewallApplicationFilter | Where-Object {$_.Program -ieq $program})
$rules=@($filters | Get-NetFirewallRule)
$removed=@($rules | Select-Object Name,DisplayName,Action,Profile)
$rules | Remove-NetFirewallRule
$remaining=@(Get-NetFirewallApplicationFilter | Where-Object {$_.Program -ieq $program} | Get-NetFirewallRule)
@{removed=$removed;remaining=$remaining.Count} | ConvertTo-Json -Depth 4 -Compress
`),
  );
}

/** Create a rule only for this verification's executable. Failure is non-fatal. */
export function allowWindowsVerificationProgram(program, name) {
  try {
    windows(
      `New-NetFirewallRule -Name ${ps(name)} -DisplayName ${ps(name)} -Direction Inbound -Action Allow -Profile Any -Program ${ps(program)} | Out-Null`,
    );
    return { name, program, created: true };
  } catch (error) {
    return { name, program, created: false, error: error.message };
  }
}

/** Remove this run's rule and record any Windows-created block for its path. */
export function cleanupWindowsVerificationProgram(rule) {
  return JSON.parse(
    windows(`
$name=${ps(rule.name)};$program=${ps(rule.program)}
Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$remaining=@(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue).Count
$blocks=@(Get-NetFirewallApplicationFilter | Where-Object {$_.Program -ieq $program} | Get-NetFirewallRule | Where-Object Action -eq Block | Select-Object Name,DisplayName,Action)
@{remaining=$remaining;blocks=$blocks} | ConvertTo-Json -Depth 4 -Compress
`),
  );
}

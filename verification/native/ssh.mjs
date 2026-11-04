import assert from "node:assert/strict";
import { writeWindows } from "../connection/build.mjs";
import { windows, ps, windowsBuildNode } from "./remote.mjs";

export async function writeWindowsPrivateKey(file, contents) {
  await writeWindows(file, contents);
  const result = JSON.parse(
    windows(`
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
Set-Acl -LiteralPath ${ps(file)} -AclObject $acl
$actual=Get-Acl -LiteralPath ${ps(file)}
$rules=@($actual.Access)
$private=$actual.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $rules[0].AccessControlType -eq 'Allow' -and $rules[0].FileSystemRights -eq 'FullControl'
[Console]::WriteLine((ConvertTo-Json -Compress @{private=$private}))
`),
  );
  assert.equal(
    result.private,
    true,
    "Windows private key ACL must allow only its owner",
  );
}

// Keep every byte outside our marked line, including BOM and line endings.
const includeSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.USERPROFILE, '.ssh', 'config');
const marker = '# iori-ssh-setup-verification';
let content = fs.existsSync(file) ? fs.readFileSync(file).toString('latin1') : null;
if (content !== null) {
  const created = content.includes(marker + ' created-config');
  const cleaned = content.replace(/^Include "[^\r\n]*" # iori-ssh-setup-verification(?: created-config)?\r?\n/gm, '');
  if (cleaned !== content) {
    if (created && !cleaned) { fs.unlinkSync(file); content = null; }
    else { fs.writeFileSync(file, Buffer.from(cleaned, 'latin1')); content = cleaned; }
  }
}
if (process.argv[1] === 'add') {
  if (content?.length) throw new Error('Windows SSH config has other content; review its use before adding the verification Include');
  const line = 'Include "' + process.argv[2].replaceAll('\\', '/') + '" ' + marker + (content === null ? ' created-config' : '') + '\r\n';
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, Buffer.concat([Buffer.from(line), Buffer.from(content ?? '', 'latin1')]));
}
console.log(JSON.stringify({included: process.argv[1] === 'add', configExists:fs.existsSync(file)}));
`;
export function windowsSshInclude(config) {
  return JSON.parse(
    windows(
      `& ${ps(windowsBuildNode)} -e ${ps(includeSource)} ${ps(config ? "add" : "remove")} ${ps(config ?? "")};if($LASTEXITCODE -ne 0){throw 'SSH Include setup/cleanup failed'}`,
    ),
  );
}

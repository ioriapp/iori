param([string]$Name)
$ErrorActionPreference = 'Stop'
$pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $Name, [IO.Pipes.PipeDirection]::InOut)
try {
    $pipe.Connect()
    $acl = $pipe.GetAccessControl()
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    @{
        otherReaders = @($rules | Where-Object { $_.IdentityReference.Value -in @('S-1-1-0', 'S-1-5-7') }).Count
        onlyCurrentUser = $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $current -and $acl.AreAccessRulesProtected
    } | ConvertTo-Json -Compress
} finally { $pipe.Dispose() }

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $base = '__IORI_RELEASE_SOURCE__'
    $base += if ($env:IORI_VERSION) { "/download/v$env:IORI_VERSION" } else { "/latest/download" }
    $destination = Join-Path $env:LOCALAPPDATA 'Programs\iori-host'
    $first = -not (Test-Path -LiteralPath (Join-Path $destination 'iori-host.cmd'))
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    $work = Join-Path (Split-Path $destination) ('.iori-host-' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $work | Out-Null
    $previousLocation = Get-Location
    $previousDirectory = [Environment]::CurrentDirectory
    try {
        # Release a caller's working directory inside the bundle before replacing it.
        Set-Location -LiteralPath $work
        [Environment]::CurrentDirectory = $work
        Invoke-WebRequest "$base/iori-host-windows-x64.zip" -OutFile "$work\host.zip" -UseBasicParsing
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory("$work\host.zip", "$work\host")
        & {
# IORI_INSTALL_BUNDLE
        } -Bundle "$work\host"
        Write-Host 'iori Hostを起動しました。'
        if ($first) { & "$destination\iori-host.cmd" invite }
    } finally {
        $parent = Split-Path $destination
        Set-Location -LiteralPath $parent
        [Environment]::CurrentDirectory = $parent
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
        if (Test-Path -LiteralPath $previousLocation.Path) { Set-Location -LiteralPath $previousLocation.Path }
        if (Test-Path -LiteralPath $previousDirectory) { [Environment]::CurrentDirectory = $previousDirectory }
    }
}

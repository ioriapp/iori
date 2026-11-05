use base64::Engine;

#[derive(Clone, Copy)]
pub enum Shell {
    Probe,
    Linux,
    Windows,
}

pub fn literal(value: &str) -> String {
    let mut result = String::from("'");
    for c in value.chars() {
        result.push(c);
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201a}' | '\u{201b}') {
            result.push(c);
        }
    }
    result.push('\'');
    result
}

// cmd expands SystemRoot even when the user's default shell is PowerShell.
// Clear the inherited PS7 module paths before Windows PowerShell builds its
// default paths, including for every cmdlet and child process used by setup.
// https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_psmodulepath
// Feed only a closed, empty pipeline to the native child so a PowerShell
// login shell cannot forward the remaining SSH command stream into it.
// The script itself never passes through either shell's argument parser.
pub fn powershell(script: &str) -> String {
    let script = format!(
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ProgressPreference='SilentlyContinue';{script}"
    );
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    format!(
        "echo \"\" | cmd.exe /d /c \"set PSModulePath=&& %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {} <NUL\"",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub fn command(shell: Shell, script: &str) -> String {
    match shell {
        Shell::Probe => format!("{script}\necho IORI_SETUP_PROBE_DONE\n"),
        Shell::Linux => {
            let inner = format!(
                "sh -c {} </dev/null 2>&1; code=$?; printf 'IORI_SETUP {{\"type\":\"done\",\"code\":%s}}\\n' \"$code\"",
                super::super::linux_install::quote(script)
            );
            format!("sh -c {}\n", super::super::linux_install::quote(&inner))
        }
        Shell::Windows => {
            // cmd has an 8191-character command limit. Transfer code in short
            // encoded commands, then remove the temporary source before running it.
            let name = format!("iori-ssh-{}.txt", iroh::SecretKey::generate().public());
            let data = base64::engine::general_purpose::STANDARD.encode(script);
            let mut lines = String::new();
            for chunk in data.as_bytes().chunks(1800) {
                lines.push_str(&powershell(&format!(
                    "[IO.File]::AppendAllText((Join-Path $env:TEMP '{}'), '{}')",
                    name,
                    String::from_utf8_lossy(chunk)
                )));
                lines.push('\n');
            }
            lines.push_str(&powershell(&format!(
                "$ErrorActionPreference='Stop';try {{ $file=Join-Path $env:TEMP '{name}';$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([IO.File]::ReadAllText($file)));Remove-Item -LiteralPath $file; & ([scriptblock]::Create($source)); [Console]::WriteLine('IORI_SETUP {{\"type\":\"done\",\"code\":0}}') }} catch {{ [Console]::WriteLine($_.Exception.Message); [Console]::WriteLine('IORI_SETUP {{\"type\":\"done\",\"code\":1}}') }}"
            )));
            lines.push('\n');
            lines
        }
    }
}

pub fn probe() -> String {
    let linux = r#"encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
installed=false; if [ -f "$HOME/.local/lib/iori-host/iori-host" ] && systemctl --user is-enabled --quiet iori-host.service; then installed=true; fi
printf 'IORI_SETUP {"type":"machine","os":"%s","cpu":"%s","user":"%s","home":"%s","installed":%s}\n' "$(encode "$(uname -s)")" "$(encode "$(uname -m)")" "$(encode "$(id -un)")" "$(encode "$HOME")" "$installed""#;
    let windows = r#"function encode([string]$value) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value)) }
$run = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'iori Host' -ErrorAction SilentlyContinue
$installed = (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\iori-host\iori-host.cmd')) -and [bool]$run
$cpu = $env:PROCESSOR_ARCHITECTURE
[Console]::WriteLine('IORI_SETUP ' + (ConvertTo-Json -Compress @{type='machine';os=(encode 'Windows');cpu=(encode $cpu);user=(encode ([Security.Principal.WindowsIdentity]::GetCurrent().Name));home=(encode $env:USERPROFILE);installed=$installed;administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))}))"#;
    format!(
        "sh -c 'echo {} | base64 -d | sh'\n{}",
        base64::engine::general_purpose::STANDARD.encode(linux),
        powershell(windows)
    )
}

pub fn control(shell: Shell, method: &str) -> String {
    match shell {
        Shell::Windows => format!(
            "& (Join-Path $env:LOCALAPPDATA 'Programs\\iori-host\\runtime\\node.exe') --input-type=module -e \"import('data:text/javascript;base64,{}')\" {}; if ($LASTEXITCODE -ne 0) {{ throw 'Host did not respond' }}",
            base64::engine::general_purpose::STANDARD.encode(include_str!("control.mjs")),
            literal(method)
        ),
        _ => format!(
            "\"$HOME/.local/lib/iori-host/runtime/node\" --input-type=module -e {} {} </dev/null",
            super::super::linux_install::quote(include_str!("control.mjs")),
            super::super::linux_install::quote(method)
        ),
    }
}

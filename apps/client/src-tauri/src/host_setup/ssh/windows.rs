use super::{
    remote::{self, Shell},
    session::{Request, emit, request},
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

pub async fn install(
    app: &tauri::AppHandle,
    session: &str,
    commands: &mpsc::UnboundedSender<Request>,
    installed: bool,
    running: bool,
    allow_connections: bool,
) -> Result<Value, String> {
    if !installed {
        emit(
            app,
            session,
            json!({"type":"stage", "stage":"verification"}),
        );
        let hash =
            super::super::linux_install::asset_hash(app, "iori-host-windows-x64.zip").await?;
        let url = format!(
            "{}v{}/iori-host-windows-x64.zip",
            crate::updates::distribution(),
            app.package_info().version
        );
        let firewall = if allow_connections {
            format!(
                "[Console]::WriteLine('IORI_SETUP {{\"type\":\"stage\",\"stage\":\"firewall\"}}'); & {{ {} }} -Remote",
                include_str!("../firewall.ps1")
            )
        } else {
            String::new()
        };
        let script = format!(
            r#"
$work = Join-Path $env:TEMP ('iori-host-ssh-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work | Out-Null
$stage='download'
try {{
    [Console]::WriteLine('IORI_SETUP {{"type":"stage","stage":"download"}}')
    Invoke-WebRequest {url} -OutFile "$work\host.zip" -UseBasicParsing
    $stage='verification'
    [Console]::WriteLine('IORI_SETUP {{"type":"stage","stage":"verification"}}')
    if ((Get-FileHash -LiteralPath "$work\host.zip" -Algorithm SHA256).Hash -ine '{hash}') {{ throw 'Could not verify iori Host. Retry downloading.' }}
    $stage='extract'
    [Console]::WriteLine('IORI_SETUP {{"type":"stage","stage":"extract"}}')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory("$work\host.zip", "$work\host")
    $stage='service'
    [Console]::WriteLine('IORI_SETUP {{"type":"stage","stage":"service"}}')
    & {{ {installer} }} -Bundle "$work\host" -InstallOnly
    {firewall}
}} catch {{
    [Console]::WriteLine('IORI_SETUP ' + (ConvertTo-Json -Compress @{{type='error';stage=$stage}}))
    throw
}} finally {{
    Remove-Item -LiteralPath $work -Recurse -Force
}}
"#,
            url = remote::literal(&url),
            installer = include_str!("../../../../../../scripts/release/install-bundle.ps1")
        );
        request(commands, Shell::Windows, script).await?;
    }
    if !running {
        emit(app, session, json!({"type":"stage","stage":"start"}));
        let values = request(commands, Shell::Windows, format!(
            "& {{ {} }} -Bundle (Join-Path $env:LOCALAPPDATA 'Programs\\iori-host') -StartOnly -Ssh",
            include_str!("../../../../../../scripts/release/install-bundle.ps1")
        )).await?;
        if values.iter().any(|v| v["type"] == "signInRequired") {
            return Ok(json!({"signInRequired":true}));
        }
    }
    emit(app, session, json!({"type":"stage","stage":"register"}));
    let values = request(
        commands,
        Shell::Windows,
        remote::control(Shell::Windows, "invite.create"),
    )
    .await?;
    let response = values
        .iter()
        .find(|v| v["type"] == "control")
        .ok_or("Host did not respond")?;
    if response["ok"] != true {
        return Err(format!(
            "IORI_CONTROL_ERROR: {}",
            response["error"]["message"]
                .as_str()
                .unwrap_or("Host did not respond")
        ));
    }
    Ok(response["result"].clone())
}

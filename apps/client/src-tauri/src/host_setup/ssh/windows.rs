use super::output::Failure;
use super::{
    remote::{self, Shell},
    session::{Request, emit, invite, request},
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

pub async fn install(
    app: &tauri::AppHandle,
    session: &str,
    commands: &mpsc::UnboundedSender<Request>,
    mode: &str,
    administrator: bool,
) -> Result<Value, Failure> {
    if mode == "install" || mode == "update" {
        emit(
            app,
            session,
            json!({"type":"stage", "stage":"verification"}),
        );
        let hash = super::super::linux_install::asset_hash(app, "iori-host-windows-x64.zip")
            .await
            .map_err(|detail| Failure {
                stage: Some("verification".into()),
                ..Failure::new("install", detail)
            })?;
        let url = format!(
            "{}v{}/iori-host-windows-x64.zip",
            crate::updates::distribution(),
            app.package_info().version
        );
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
    // Only administrator accounts can grant the per-installation rule over SSH.
    // Other existing Hosts are checked by the UI's subsequent Direct connection.
    let firewall_allowed = if administrator {
        emit(app, session, json!({"type":"stage","stage":"firewall"}));
        let values = request(
            commands,
            Shell::Windows,
            format!("$allowed = & {{ {} }} -Remote; [Console]::WriteLine('IORI_SETUP ' + (ConvertTo-Json -Compress @{{type='firewall';allowed=[bool]$allowed}}))", include_str!("../firewall.ps1")),
        )
        .await?;
        values
            .iter()
            .any(|v| v["type"] == "firewall" && v["allowed"] == true)
    } else {
        false
    };
    // The initial probe can predate sign-in. Recheck the local control endpoint
    // for every registration attempt before scheduling another Host.
    let responding = request(
        commands,
        Shell::Windows,
        remote::control(Shell::Windows, "host.info"),
    )
    .await
    .ok()
    .is_some_and(|values| {
        values
            .iter()
            .any(|v| v["type"] == "control" && v["ok"] == true)
    });
    if !responding {
        emit(app, session, json!({"type":"stage","stage":"start"}));
        let values = request(commands, Shell::Windows, format!(
            "& {{ {} }} -Bundle (Join-Path $env:LOCALAPPDATA 'Programs\\iori-host') -StartOnly -Ssh",
            include_str!("../../../../../../scripts/release/install-bundle.ps1")
        )).await?;
        if values.iter().any(|v| v["type"] == "signInRequired") {
            return Ok(json!({"type":"signInRequired"}));
        }
    }
    if firewall_allowed {
        let info = request(
            commands,
            Shell::Windows,
            remote::control(Shell::Windows, "host.info"),
        )
        .await?;
        if info.iter().any(|v| {
            v["type"] == "control"
                && v["ok"] == true
                && v["result"]["connectionScope"] == "loopback"
        }) {
            let values = request(
                commands,
                Shell::Windows,
                remote::control(Shell::Windows, "host.connections.allow"),
            )
            .await?;
            if !values
                .iter()
                .any(|v| v["type"] == "control" && v["ok"] == true)
            {
                return Err(Failure::new("install", "Host did not respond"));
            }
        }
    }
    emit(app, session, json!({"type":"stage","stage":"register"}));
    let values = request(
        commands,
        Shell::Windows,
        remote::control(Shell::Windows, "invite.create"),
    )
    .await?;
    invite(&values)
}

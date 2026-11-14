use crate::updates::{distribution, http, release};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpStream,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
};
use tauri::{Emitter, Manager};

fn local_root() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or("install".into())
}
fn bundle() -> Result<PathBuf, String> {
    Ok(local_root()?.join("Programs").join("iori-host"))
}
fn ps_literal(value: &str) -> String {
    let mut escaped = String::from("'");
    // PowerShell Language.CodeGeneration.EscapeSingleQuotedStringContent.
    for c in value.chars() {
        escaped.push(c);
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201a}' | '\u{201b}') {
            escaped.push(c);
        }
    }
    escaped.push('\'');
    escaped
}
fn powershell(script: &str, firewall_query: Option<bool>) -> Result<String, String> {
    use base64::Engine;
    let script = format!("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);{script}");
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let executable = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or("install")?
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = Command::new(executable);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
        ])
        .arg(base64::engine::general_purpose::STANDARD.encode(bytes))
        .env_remove("IORI_FIREWALL_QUERY")
        .env_remove("PSModulePath")
        .creation_flags(0x08000000);
    if let Some(query) = firewall_query {
        command.env("IORI_FIREWALL_QUERY", if query { "1" } else { "0" });
    }
    let output = command.output().map_err(|error| {
        eprintln!("[host-setup] Could not start PowerShell: {error}");
        "install"
    })?;
    if !output.stderr.is_empty() {
        eprintln!(
            "[host-setup] PowerShell: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    if !output.status.success() {
        eprintln!("[host-setup] PowerShell exited: {}", output.status);
        return Err("install".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
fn local_exchange(method: &str) -> Result<Value, String> {
    let file = local_root()?.join("iori-host").join("control.json");
    let bytes = std::fs::read(file).map_err(|_| "local")?;
    #[derive(Deserialize)]
    struct Control {
        port: u16,
        token: String,
    }
    let control: Control = serde_json::from_slice(&bytes).map_err(|_| "local")?;
    let mut socket =
        TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, control.port)).map_err(|_| "local")?;
    let request = serde_json::to_vec(&json!({"token": control.token, "operationId": format!("setup-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "local")?.as_nanos()), "method": method, "params": {}})).map_err(|_| "local")?;
    socket
        .write_all(&(request.len() as u32).to_be_bytes())
        .and_then(|_| socket.write_all(&request))
        .map_err(|_| "local")?;
    // Local control accepts exactly one frame and checks it when the sender
    // finishes writing. Keep the read half open for the response.
    socket
        .shutdown(std::net::Shutdown::Write)
        .map_err(|_| "local")?;
    let mut header = [0u8; 4];
    socket.read_exact(&mut header).map_err(|_| "local")?;
    let length = u32::from_be_bytes(header) as usize;
    if length > crate::native::MAX_FRAME_BYTES {
        return Err("local".into());
    }
    let mut body = vec![0; length];
    socket.read_exact(&mut body).map_err(|_| "local")?;
    let response: Value = serde_json::from_slice(&body).map_err(|_| "local")?;
    Ok(response)
}
pub fn local_request(method: &str) -> Result<Value, String> {
    let response = local_exchange(method)?;
    if response["ok"] != true {
        return Err("local".into());
    }
    Ok(response["result"].clone())
}
pub fn status() -> Result<Value, String> {
    let bundle = bundle()?;
    let installed = bundle.join("iori-host.cmd").is_file();
    let running_info = local_request("host.info").ok();
    let installed = installed || running_info.is_some();
    let version = std::fs::read(bundle.join("release-version.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    Ok(
        json!({"canAllowConnections": true, "installed": installed, "host": running_info, "version": version.and_then(|v| v["version"].as_str().map(String::from)), "name": std::env::var("COMPUTERNAME").ok()}),
    )
}
pub fn firewall_status() -> Result<bool, String> {
    powershell(include_str!("firewall.ps1"), Some(true)).map(|v| v == "true")
}
fn firewall_permission(app: &tauri::AppHandle) -> Result<bool, String> {
    let result = powershell(include_str!("firewall.ps1"), Some(false)).map(|v| v == "true");
    crate::windows_notifications::show_window(app);
    result
}
pub fn firewall(app: &tauri::AppHandle) -> Result<bool, String> {
    let result = firewall_permission(app);
    if result.as_ref().is_ok_and(|allowed| *allowed)
        && local_request("host.info")?["connectionScope"] == "loopback"
    {
        local_request("host.connections.allow")?;
    }
    result
}
fn stage(app: &tauri::AppHandle, value: &str) {
    let _ = app.emit("native://host-setup-stage", value);
}
#[derive(Deserialize)]
struct Manifest {
    version: semver::Version,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    sha256: String,
}
async fn get(client: &reqwest::Client, url: String) -> Result<reqwest::Response, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|_| "download")?
        .error_for_status()
        .map_err(|_| "download".into())
}
fn write_connection_scope(scope: &str) -> Result<(), String> {
    let root = local_root()?.join("iori-host");
    std::fs::create_dir_all(&root).map_err(|_| "install")?;
    let temporary = root.join("network.json.tmp");
    let result = (|| {
        let mut file = std::fs::File::create(&temporary).map_err(|_| "install")?;
        file.write_all(&serde_json::to_vec(&json!({"scope": scope})).map_err(|_| "install")?)
            .map_err(|_| "install")?;
        file.sync_all().map_err(|_| "install")?;
        drop(file);
        std::fs::rename(&temporary, root.join("network.json")).map_err(|_| "install".into())
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}
pub async fn install(app: tauri::AppHandle, allow_connections: bool) -> Result<bool, String> {
    let running = tauri::async_runtime::spawn_blocking(|| local_exchange("host.info").is_ok())
        .await
        .map_err(|_| "local")?;
    let already = running || bundle()?.join("iori-host.cmd").is_file();
    let work = app
        .path()
        .app_cache_dir()
        .map_err(|_| "install")?
        .join("host-setup");
    std::fs::create_dir_all(&work).map_err(|_| "install")?;
    // The script is shared with the command installer; it runs as this user.
    let installer = work.join("install-bundle.ps1");
    std::fs::write(
        &installer,
        include_str!("../../../../../scripts/release/install-bundle.ps1"),
    )
    .map_err(|_| "install")?;
    let result = async {
        if !already {
            stage(&app, "download");
            let client = http(reqwest::Client::builder()).build().map_err(|_| "download")?;
            let base = format!("{}v{}/", distribution(), app.package_info().version);
            let bytes = get(&client, format!("{base}release.json")).await?.bytes().await.map_err(|_| "download")?;
            let signature = get(&client, format!("{base}release.json.sig")).await?.bytes().await.map_err(|_| "download")?;
            let manifest: Manifest = release::verify(&bytes, &signature).map_err(|_| "verification")?;
            if manifest.version != app.package_info().version { return Err("verification".into()); }
            let asset = manifest.assets.into_iter().find(|a| a.name == "iori-host-windows-x64.zip").ok_or("verification")?;
            let archive = work.join("host.zip");
            let mut file = std::fs::File::create(&archive).map_err(|_| "install")?;
            let mut response = get(&client, format!("{base}{}", asset.name)).await?;
            let mut hash = Sha256::new();
            let mut size = 0u64;
            while let Some(bytes) = response.chunk().await.map_err(|_| "download")? {
                size += bytes.len() as u64;
                if size > asset.size { return Err("verification".into()); }
                hash.update(&bytes);
                file.write_all(&bytes).map_err(|_| "install")?;
            }
            drop(file);
            stage(&app, "verification");
            let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
            if size != asset.size || digest != asset.sha256 { return Err("verification".into()); }
            stage(&app, "extract");
            let extracted = work.join("host");
            if extracted.exists() { std::fs::remove_dir_all(&extracted).map_err(|_| "install")?; }
            let script = format!("$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory({}, {})", ps_literal(&archive.to_string_lossy()), ps_literal(&extracted.to_string_lossy()));
            tauri::async_runtime::spawn_blocking(move || powershell(&script, None)).await.map_err(|_| "install")??;
        }
        if !already {
            // Persist the restricted scope before registering logon startup.
            write_connection_scope("loopback")?;
            // Windows PowerShell reads a BOM-less file using the system code
            // page. Decode UTF-8 explicitly, as the command installer does.
            let script = format!("$ErrorActionPreference='Stop';& ([scriptblock]::Create([IO.File]::ReadAllText({}))) -Bundle {} -InstallOnly -KeepConnectionScope", ps_literal(&installer.to_string_lossy()), ps_literal(&work.join("host").to_string_lossy()));
            tauri::async_runtime::spawn_blocking(move || powershell(&script, None)).await.map_err(|_| "install")??;
        }
        let allowed = if !already && allow_connections {
            stage(&app, "firewall");
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || firewall_permission(&handle)).await.map_err(|_| "install")?.unwrap_or(false)
        } else { false };
        if allowed {
            write_connection_scope("network")?;
        }
        stage(&app, "start");
        if !running {
            let script = format!("$ErrorActionPreference='Stop';& ([scriptblock]::Create([IO.File]::ReadAllText({}))) -Bundle {} -StartOnly", ps_literal(&installer.to_string_lossy()), ps_literal(&work.join("host").to_string_lossy()));
            tauri::async_runtime::spawn_blocking(move || powershell(&script, None)).await.map_err(|_| "install")??;
        }
        Ok(allowed)
    }.await;
    let _ = std::fs::remove_dir_all(&work);
    result
}

pub fn uninstall_result(host_key: &str, operation_id: &str, remove: bool) -> Result<Value, String> {
    let name = super::receipt_name(host_key, operation_id)?;
    let path = local_root()?.join("iori-host-uninstall").join(name);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(error) => return Err(error.to_string()),
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if remove {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(value["status"].clone())
}

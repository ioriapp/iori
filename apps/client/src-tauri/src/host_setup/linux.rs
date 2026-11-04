use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio};
use tauri::Emitter;
use tokio::{io::AsyncBufReadExt, io::BufReader, process::Command};

fn home() -> Result<PathBuf, String> {
    super::ssh::platform::home()
}
fn data_root() -> Result<PathBuf, String> {
    Ok(std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".local/share")))
}
async fn local_request(method: &str) -> Result<Value, String> {
    // Use the same bundled helper and user-only control endpoint as SSH setup.
    let output = Command::new(home()?.join(".local/lib/iori-host/runtime/node"))
        .args([
            "--input-type=module",
            "-e",
            include_str!("ssh/control.mjs"),
            method,
        ])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| error.to_string())?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(value) = super::ssh::output::parse_line(line)?
            && value["type"] == "control"
        {
            if value["ok"] == true {
                return Ok(value["result"].clone());
            }
            return Err(value["error"]["message"]
                .as_str()
                .unwrap_or("Host did not respond")
                .into());
        }
    }
    Err("Host did not respond".into())
}

pub async fn status() -> Result<Value, String> {
    let bundle = home()?.join(".local/lib/iori-host");
    let host = local_request("host.info").await.ok();
    let installed = host.is_some()
        || (bundle.join("iori-host").is_file()
            && Command::new("systemctl")
                .args(["--user", "is-enabled", "--quiet", "iori-host.service"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map(|status| status.success())
                .unwrap_or(false));
    let version = std::fs::read(bundle.join("release-version.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let user = Command::new("id")
        .arg("-un")
        .stdin(Stdio::null())
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|user| user.trim().to_string());
    Ok(json!({
        "installed": installed, "host": host, "canAllowConnections": false, "user": user,
        "version": version.and_then(|value| value["version"].as_str().map(String::from)),
        "name": std::fs::read_to_string("/etc/hostname").ok().map(|name| name.trim().to_string())
    }))
}

fn failure(stage: &str, message: impl std::fmt::Display) -> String {
    format!("LOCAL_SETUP_FAILED:{stage}\n{message}")
}
async fn run(app: &tauri::AppHandle, script: &str) -> Result<(), String> {
    let mut child = Command::new("sh")
        .args(["-c", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| failure("install", error))?;
    let stderr = child.stderr.take().ok_or("install")?;
    let errors = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut last = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                last = line;
            }
        }
        last
    });
    let mut lines = BufReader::new(child.stdout.take().ok_or("install")?).lines();
    let mut stage = "install".to_string();
    let mut detail = String::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| failure(&stage, error))?
    {
        if let Some(value) = super::ssh::output::parse_line(&line)? {
            if value["type"] == "stage" {
                if let Some(next) = value["stage"].as_str() {
                    stage = next.to_string();
                    let _ = app.emit("native://host-setup-stage", next);
                }
            } else if value["type"] == "linger" && value["enabled"] == false {
                let _ = app.emit("native://host-setup-linger", ());
            }
        } else if !line.trim().is_empty() {
            detail = line;
        }
    }
    let status = child.wait().await.map_err(|error| failure(&stage, error))?;
    let stderr = errors.await.map_err(|error| failure(&stage, error))?;
    if !status.success() {
        return Err(failure(
            &stage,
            if stderr.is_empty() { detail } else { stderr },
        ));
    }
    Ok(())
}

pub async fn install(app: tauri::AppHandle) -> Result<bool, String> {
    let current = status().await?;
    if current["installed"] != true {
        let _ = app.emit("native://host-setup-stage", "verification");
        let script = super::linux_install::installer(&app)
            .await
            .map_err(|error| failure("verification", error))?;
        run(&app, &script).await?;
    } else if current["host"].is_null() {
        let _ = app.emit("native://host-setup-stage", "start");
        run(&app, super::linux_install::START_EXISTING).await?;
    }
    // This return value is the Windows firewall result; Linux has no such setting.
    Ok(false)
}
pub async fn invite() -> Result<Value, String> {
    local_request("invite.create")
        .await
        .map_err(|error| failure("local", error))
}
pub fn uninstall_result(host_key: &str, operation_id: &str, remove: bool) -> Result<Value, String> {
    let path = data_root()?
        .join("iori-host-uninstall")
        .join(super::receipt_name(host_key, operation_id)?);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(error) => return Err(error.to_string()),
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if remove {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(value["status"].clone())
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(windows, target_os = "linux"))]
mod linux_install;
#[cfg(desktop)]
pub mod ssh;
#[cfg(windows)]
mod windows;

#[tauri::command]
pub async fn native_host_setup_status() -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(windows::status)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    return linux::status().await;
    #[cfg(not(any(windows, target_os = "linux")))]
    Ok(serde_json::Value::Null)
}
#[tauri::command]
pub async fn native_host_setup_install(
    app: tauri::AppHandle,
    allow_connections: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    return windows::install(app, allow_connections).await;
    #[cfg(target_os = "linux")]
    {
        let _ = allow_connections;
        linux::install(app).await
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (app, allow_connections);
        Err("unsupported".into())
    }
}
#[tauri::command]
pub async fn native_host_setup_invite() -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(|| windows::local_request("invite.create"))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    return linux::invite().await;
    #[cfg(not(any(windows, target_os = "linux")))]
    Err("unsupported".into())
}
#[tauri::command]
pub async fn native_host_firewall(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || windows::firewall(&app))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

#[tauri::command]
pub async fn native_host_firewall_status() -> Result<Option<bool>, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(windows::firewall_status)
        .await
        .map_err(|e| e.to_string())?
        .map(Some);
    #[cfg(not(windows))]
    Ok(None)
}

#[cfg(any(windows, target_os = "linux"))]
fn receipt_name(host_key: &str, operation_id: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(&[host_key, operation_id]).map_err(|e| e.to_string())?;
    let digest = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("{digest}.json"))
}
#[tauri::command]
pub async fn native_host_uninstall_result(
    host_key: String,
    operation_id: String,
    remove: bool,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || {
        windows::uninstall_result(&host_key, &operation_id, remove)
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(move || {
        linux::uninstall_result(&host_key, &operation_id, remove)
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (host_key, operation_id, remove);
        Ok(serde_json::Value::Null)
    }
}

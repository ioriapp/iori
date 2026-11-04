use super::Failure;
use std::os::unix::fs::PermissionsExt;
use tauri::utils::{config::BundleType, platform::bundle_type};
use tauri_plugin_updater::Update;

pub fn is_deb() -> bool {
    bundle_type() == Some(BundleType::Deb)
}

pub async fn install(update: &Update, bytes: &[u8]) -> Result<&'static str, Failure> {
    if !is_deb() {
        return update
            .install(bytes)
            .map(|()| "installing")
            .map_err(|error| match &error {
                tauri_plugin_updater::Error::Io(error)
                    if matches!(error.raw_os_error(), Some(1 | 13 | 30)) =>
                {
                    Failure::AppImageLocation.log(error)
                }
                _ => Failure::Install.log(error),
            });
    }
    // The plugin retries with zenity/kdialog/sudo after pkexec cancellation.
    // Keep one OS confirmation, and keep the verified bytes inside a 0700 dir.
    let directory = tempfile::Builder::new()
        .prefix("iori-client-update-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()
        .map_err(|error| Failure::Install.log(error))?;
    let package = directory.path().join("update.deb");
    std::fs::write(&package, bytes).map_err(|error| Failure::Install.log(error))?;
    let status = tokio::process::Command::new("pkexec")
        .args(["dpkg", "-i"])
        .arg(package)
        .status()
        .await
        .map_err(|error| Failure::Install.log(error))?;
    if status.success() {
        Ok("installing")
    } else if status.code() == Some(126) {
        Ok("cancelled")
    } else {
        Err(Failure::Install.log(status))
    }
}

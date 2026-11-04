#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::{ApkInstaller, ApkInstallerExt, init};

/// Success is usually observed on next launch; Installed covers a surviving process.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InstallOutcome {
    Installed,
    Cancelled,
    Failed { reason: String },
}

#[cfg(target_os = "linux")]
mod linux;
use serde::Serialize;

#[cfg(target_os = "android")]
mod android;
#[cfg(any(windows, target_os = "linux"))]
mod desktop;
#[cfg(target_os = "android")]
use android as platform;
#[cfg(any(windows, target_os = "linux"))]
use desktop as platform;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Failure {
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    Source,
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    Verification,
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    Download,
    Install,
    #[cfg(target_os = "linux")]
    AppImageLocation,
}
#[cfg(any(windows, target_os = "linux", target_os = "android"))]
impl Failure {
    fn log(self, error: impl std::fmt::Debug) -> Self {
        eprintln!("[client-update] {error:?}");
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    version: String,
    background_download: bool,
    foreground_only: bool,
    administrator_approval: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    notes_url: String,
}

#[cfg(any(windows, target_os = "linux", target_os = "android"))]
pub fn setup(app: &tauri::AppHandle) {
    use tauri::Manager;
    app.manage(platform::Pending::default());
}

#[tauri::command]
pub fn native_update_options(app: tauri::AppHandle) -> Option<Options> {
    if cfg!(any(windows, target_os = "linux", target_os = "android")) {
        Some(Options {
            version: app.package_info().version.to_string(),
            background_download: cfg!(any(windows, target_os = "linux")),
            foreground_only: cfg!(target_os = "android"),
            administrator_approval: {
                #[cfg(target_os = "linux")]
                {
                    linux::is_deb()
                }
                #[cfg(not(target_os = "linux"))]
                {
                    false
                }
            },
        })
    } else {
        None
    }
}
#[tauri::command]
pub async fn native_update_check(
    app: tauri::AppHandle,
    development: bool,
) -> Result<Option<Available>, Failure> {
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    return platform::check(&app, development).await;
    #[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
    {
        let _ = (app, development);
        Ok(None)
    }
}
#[tauri::command]
pub async fn native_update_download(app: tauri::AppHandle) -> Result<(), Failure> {
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    return platform::download(&app).await;
    #[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
    {
        let _ = app;
        Err(Failure::Install)
    }
}
#[tauri::command]
pub async fn native_update_install(app: tauri::AppHandle, resume: bool) -> Result<String, Failure> {
    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    return platform::install(&app, resume).await;
    #[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
    {
        let _ = (app, resume);
        Err(Failure::Install)
    }
}

#[tauri::command]
pub async fn native_update_resume_installation(app: tauri::AppHandle) -> Result<(), Failure> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_apk_installer::ApkInstallerExt;
        app.apk_installer()
            .resume_installation()
            .await
            .map_err(|e| Failure::Install.log(e))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(Failure::Install)
    }
}

#[cfg(any(windows, target_os = "linux", target_os = "android"))]
const RELEASES: &str = include_str!("../../../../../release-source.txt");
#[cfg(any(windows, target_os = "linux", target_os = "android"))]
fn notes(version: &str) -> String {
    format!("{}/tag/v{version}", RELEASES.trim())
}

#[cfg(any(windows, target_os = "linux", target_os = "android"))]
pub(crate) fn distribution() -> String {
    format!("{}/download/", RELEASES.trim())
}
#[cfg(any(windows, target_os = "linux", target_os = "android"))]
fn allowed(url: &reqwest::Url) -> bool {
    let source = reqwest::Url::parse(RELEASES.trim()).expect("Release source URL");
    release::allowed(url, &source)
}
#[cfg(any(windows, target_os = "linux", target_os = "android"))]
pub(crate) fn http(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder.redirect(reqwest::redirect::Policy::custom(|attempt| {
        if allowed(attempt.url()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    }))
}

#[cfg(any(windows, target_os = "linux", target_os = "android"))]
pub(crate) mod release;

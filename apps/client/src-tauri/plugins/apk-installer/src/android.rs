use crate::InstallOutcome;
use tauri::{
    AppHandle, Manager, Runtime,
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

pub struct ApkInstaller<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ApkInstaller<R> {
    pub async fn can_request_package_installs(&self) -> Result<bool, String> {
        #[derive(serde::Deserialize)]
        struct Permission {
            allowed: bool,
        }
        self.0
            .run_mobile_plugin_async::<Permission>("canRequestPackageInstalls", ())
            .await
            .map(|permission| permission.allowed)
            .map_err(|error| error.to_string())
    }

    /// Returns when Settings opens; re-read permission when the app resumes.
    pub async fn open_install_permission_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async("openInstallPermissionSettings", ())
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn resume_installation(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async("resumeInstallation", ())
            .await
            .map_err(|error| error.to_string())
    }

    /// The caller supplies a verified APK in private app storage.
    /// Success usually replaces this process; Installed resolves if it survives.
    pub async fn install_apk(
        &self,
        path: &str,
        on_confirmation: Channel<bool>,
    ) -> Result<InstallOutcome, String> {
        self.0
            .run_mobile_plugin_async(
                "installApk",
                serde_json::json!({ "path": path, "onConfirmation": on_confirmation }),
            )
            .await
            .map_err(|error| error.to_string())
    }
}

pub trait ApkInstallerExt<R: Runtime> {
    fn apk_installer(&self) -> &ApkInstaller<R>;
}

impl<R: Runtime, T: Manager<R>> ApkInstallerExt<R> for T {
    fn apk_installer(&self) -> &ApkInstaller<R> {
        self.state::<ApkInstaller<R>>().inner()
    }
}

#[tauri::command]
async fn can_request_package_installs<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    app.apk_installer().can_request_package_installs().await
}

#[tauri::command]
async fn open_install_permission_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.apk_installer().open_install_permission_settings().await
}

#[tauri::command]
async fn install_apk<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    on_confirmation: Channel<bool>,
) -> Result<InstallOutcome, String> {
    app.apk_installer()
        .install_apk(&path, on_confirmation)
        .await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("apk-installer")
        .invoke_handler(tauri::generate_handler![
            can_request_package_installs,
            open_install_permission_settings,
            install_apk
        ])
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "io.github.ioriapp.iori.apkinstaller",
                "ApkInstallerPlugin",
            )?;
            app.manage(ApkInstaller(handle));
            Ok(())
        })
        .build()
}

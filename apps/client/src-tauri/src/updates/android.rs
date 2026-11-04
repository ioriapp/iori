use super::{Available, Failure, distribution, notes};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{io::Write, path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};
use tauri_plugin_apk_installer::{ApkInstallerExt, InstallOutcome};
use tokio::sync::Mutex;

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
struct Download {
    version: String,
    asset: Asset,
    verified: Mutex<Option<PathBuf>>,
}
#[derive(Default)]
pub struct Pending(Mutex<Option<Arc<Download>>>);
async fn get(client: &reqwest::Client, path: &str) -> Result<reqwest::Response, Failure> {
    let url = reqwest::Url::parse(path).map_err(|e| Failure::Source.log(e))?;
    eprintln!("[client-update] GET {url}");
    client
        .get(url)
        .send()
        .await
        .map_err(|e| Failure::Source.log(e))?
        .error_for_status()
        .map_err(|e| Failure::Source.log(e))
}
pub async fn check(
    app: &tauri::AppHandle,
    development: bool,
) -> Result<Option<Available>, Failure> {
    let client = super::release::client()?;
    let Some(endpoint) = super::release::endpoint(development, "release.json").await? else {
        *app.state::<Pending>().0.lock().await = None;
        return Ok(None);
    };
    let bytes = get(&client, &endpoint)
        .await?
        .bytes()
        .await
        .map_err(|e| Failure::Source.log(e))?;
    // Pin the signature to the manifest's version: latest can change between requests.
    let unsigned: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| Failure::Verification.log(e))?;
    let signature = get(
        &client,
        &format!("{}v{}/release.json.sig", distribution(), unsigned.version),
    )
    .await?
    .bytes()
    .await
    .map_err(|e| Failure::Source.log(e))?;
    let manifest: Manifest =
        super::release::verify(&bytes, &signature).map_err(|e| Failure::Verification.log(e))?;
    if !manifest
        .version
        .cmp_precedence(&app.package_info().version)
        .is_gt()
    {
        *app.state::<Pending>().0.lock().await = None;
        return Ok(None);
    }
    let asset = manifest
        .assets
        .into_iter()
        .find(|asset| asset.name == "iori-android-arm64.apk")
        .ok_or_else(|| Failure::Verification.log("Release has no Android APK"))?;
    let version = manifest.version.to_string();
    let state = app.state::<Pending>();
    let mut pending = state.0.lock().await;
    if pending
        .as_ref()
        .is_none_or(|previous| previous.version != version)
    {
        *pending = Some(Arc::new(Download {
            version: version.clone(),
            asset,
            verified: Mutex::new(None),
        }));
    }
    Ok(Some(Available {
        notes_url: notes(&version),
        version,
    }))
}
pub async fn download(app: &tauri::AppHandle) -> Result<(), Failure> {
    let state = app.state::<Pending>();
    let update = state.0.lock().await.clone().ok_or(Failure::Download)?;
    if update.verified.lock().await.is_some() {
        return Ok(());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| Failure::Download.log(e))?
        .join("updates");
    std::fs::create_dir_all(&directory).map_err(|e| Failure::Download.log(e))?;
    let path = directory.join("update.apk");
    let mut file = std::fs::File::create(&path).map_err(|e| Failure::Download.log(e))?;
    let mut response = get(
        &super::release::client()?,
        &format!(
            "{}v{}/{}",
            distribution(),
            update.version,
            update.asset.name
        ),
    )
    .await?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| Failure::Source.log(e))? {
        received += chunk.len() as u64;
        if received > update.asset.size {
            return Err(Failure::Verification.log("APK size does not match the signed Release"));
        }
        file.write_all(&chunk)
            .map_err(|e| Failure::Download.log(e))?;
        hash.update(&chunk);
        let _ = app.emit(
            "native://update-progress",
            serde_json::json!({"received": received, "total": update.asset.size}),
        );
    }
    let checksum: String = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if received != update.asset.size || checksum != update.asset.sha256 {
        return Err(Failure::Verification.log("APK does not match the signed Release"));
    }
    file.flush().map_err(|e| Failure::Download.log(e))?;
    *update.verified.lock().await = Some(path);
    Ok(())
}
pub async fn install(app: &tauri::AppHandle, resume: bool) -> Result<String, Failure> {
    let update = app
        .state::<Pending>()
        .0
        .lock()
        .await
        .clone()
        .ok_or(Failure::Download)?;
    let path = update
        .verified
        .lock()
        .await
        .clone()
        .ok_or(Failure::Download)?;
    let installer = app.apk_installer();
    if !installer
        .can_request_package_installs()
        .await
        .map_err(|e| Failure::Install.log(e))?
    {
        if !resume {
            installer
                .open_install_permission_settings()
                .await
                .map_err(|e| Failure::Install.log(e))?;
        }
        return Ok("permission".into());
    }
    let handle = app.clone();
    let on_confirmation = tauri::ipc::Channel::<bool>::new(move |message| {
        let available: bool = message.deserialize()?;
        let _ = handle.emit("native://update-confirmation", available);
        Ok(())
    });
    match installer
        .install_apk(path.to_str().ok_or(Failure::Install)?, on_confirmation)
        .await
        .map_err(|e| Failure::Install.log(e))?
    {
        InstallOutcome::Installed => Ok("installing".into()),
        InstallOutcome::Cancelled => Ok("cancelled".into()),
        InstallOutcome::Failed { reason } => Err(Failure::Install.log(reason)),
    }
}

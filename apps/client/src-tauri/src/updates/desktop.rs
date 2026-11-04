use super::{Available, Failure, allowed, http, notes};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Option<Vec<u8>>)>>);

pub async fn check(
    app: &tauri::AppHandle,
    development: bool,
) -> Result<Option<Available>, Failure> {
    let Some(endpoint) = super::release::endpoint(development, "updater.json").await? else {
        *app.state::<Pending>().0.lock().await = None;
        return Ok(None);
    };
    let endpoint = endpoint
        .parse()
        .map_err(|e: url::ParseError| Failure::Source.log(e))?;
    let update = app
        .updater_builder()
        .version_comparator(|current, release| release.version.cmp_precedence(&current).is_gt())
        .endpoints(vec![endpoint])
        .map_err(|e| Failure::Source.log(e))?
        .configure_client(http)
        .build()
        .map_err(|e| Failure::Source.log(e))?
        .check()
        .await
        .map_err(|e| Failure::Source.log(e))?;
    let state = app.state::<Pending>();
    let mut pending = state.0.lock().await;
    let available = update.as_ref().map(|update| Available {
        version: update.version.clone(),
        notes_url: notes(&update.version),
    });
    if let Some(update) = update {
        if !allowed(&update.download_url) {
            return Err(Failure::Verification.log("Update download is outside the distribution"));
        }
        if pending
            .as_ref()
            .is_none_or(|(previous, _)| previous.version != update.version)
        {
            *pending = Some((update, None));
        }
    } else {
        *pending = None;
    }
    Ok(available)
}
pub async fn download(app: &tauri::AppHandle) -> Result<(), Failure> {
    let state = app.state::<Pending>();
    let update = {
        let pending = state.0.lock().await;
        let (update, bytes) = pending.as_ref().ok_or(Failure::Download)?;
        if bytes.is_some() {
            return Ok(());
        }
        update.clone()
    };
    let downloaded = update
        .download(|_, _| {}, || {})
        .await
        .map_err(download_error)?;
    if let Some((current, bytes)) = state.0.lock().await.as_mut()
        && current.version == update.version
    {
        *bytes = Some(downloaded);
    }
    Ok(())
}
pub async fn install(app: &tauri::AppHandle, _resume: bool) -> Result<String, Failure> {
    let state = app.state::<Pending>();
    let pending = state.0.lock().await;
    let (update, bytes) = pending.as_ref().ok_or(Failure::Download)?;
    let bytes = bytes.as_ref().ok_or(Failure::Download)?;
    // The Windows updater exits directly, bypassing Tauri's normal Exit event.
    if let Err(error) =
        app.save_window_state(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
    {
        eprintln!("Could not save window state before update: {error}");
    }
    #[cfg(windows)]
    update.install(bytes).map_err(|e| Failure::Install.log(e))?;
    #[cfg(target_os = "linux")]
    {
        let result = super::linux::install(update, bytes).await?;
        if result == "cancelled" {
            return Ok(result.into());
        }
        app.restart();
    }
    // NSIS updater exits this process and restarts the installed application.
    #[cfg(windows)]
    Ok("installing".into())
}

fn download_error(error: tauri_plugin_updater::Error) -> Failure {
    use tauri_plugin_updater::Error;
    let kind = match &error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => Failure::Verification,
        Error::Reqwest(_) | Error::Network(_) => Failure::Source,
        _ => Failure::Download,
    };
    kind.log(error)
}

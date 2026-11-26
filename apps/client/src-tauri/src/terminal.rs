use std::sync::Arc;

use iroh::endpoint::SendStream;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{Mutex, Notify, watch};

use crate::native::{NativeContext, get_connection, read_frame, write_frame};

pub(crate) struct TerminalStream {
    send: Mutex<SendStream>,
    stopped: watch::Sender<bool>,
    acknowledged: Notify,
}

impl TerminalStream {
    async fn write(&self, json: &str) -> Result<(), String> {
        let mut cancelled = self.stopped.subscribe();
        if *cancelled.borrow() {
            return Err("terminal stream is closed".to_owned());
        }
        tokio::select! {
            _ = cancelled.changed() => Err("terminal stream is closed".to_owned()),
            result = async {
                let mut send = self.send.lock().await;
                write_frame(&mut send, json.as_bytes()).await
            } => result,
        }
    }

    async fn stop(&self) {
        // The frontend drains accepted input before detaching. FIN preserves
        // bytes already buffered by QUIC; RESET could discard them at the Host.
        let _ = self.send.lock().await.finish();
        self.stopped.send_replace(true);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrame {
    connection_id: String,
    stream_id: String,
    json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalEnded {
    connection_id: String,
    stream_id: String,
    reason: Option<String>,
}

#[tauri::command]
pub(crate) async fn native_terminal_open(
    connection_id: String,
    stream_id: String,
    json: String,
    app: AppHandle<Wry>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    let connection = get_connection(&state, &connection_id).await?;
    let (send, mut receive) = connection
        .open_bi()
        .await
        .map_err(|error| error.to_string())?;
    let (stopped, mut cancelled) = watch::channel(false);
    let stream = Arc::new(TerminalStream {
        send: Mutex::new(send),
        stopped,
        acknowledged: Notify::new(),
    });
    let previous = state
        .terminals
        .lock()
        .await
        .insert(stream_id.clone(), stream.clone());
    if let Some(previous) = previous {
        previous.stop().await;
    }
    let read_stream = stream.clone();
    let reader_id = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let reason = loop {
            let result = tokio::select! {
                _ = cancelled.changed() => break None,
                result = read_frame(&mut receive) => result,
            };
            match result {
                Ok(Some(json)) => {
                    if app
                        .emit(
                            "native://terminal-frame",
                            TerminalFrame {
                                connection_id: connection_id.clone(),
                                stream_id: reader_id.clone(),
                                json,
                            },
                        )
                        .is_err()
                    {
                        break Some("could not deliver terminal output".to_owned());
                    }
                    // Read only after xterm has applied this frame. A slow WebView
                    // then applies QUIC backpressure rather than accumulating IPC output.
                    tokio::select! {
                        _ = cancelled.changed() => break None,
                        _ = read_stream.acknowledged.notified() => {},
                    }
                }
                Ok(None) => break None,
                Err(error) => break Some(error.to_string()),
            }
        };
        let _ = receive.stop(0_u32.into());
        // The Host can retire only its output half when this view falls behind.
        // Keep the input writer until the frontend drains its queue and detaches.
        let _ = app.emit(
            "native://terminal-ended",
            TerminalEnded {
                connection_id,
                stream_id: reader_id,
                reason,
            },
        );
    });
    match stream.write(&json).await {
        Ok(()) => Ok(()),
        Err(error) => {
            stream.stop().await;
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn native_terminal_acknowledge(
    stream_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    if let Some(stream) = state.terminals.lock().await.get(&stream_id) {
        stream.acknowledged.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_terminal_write(
    stream_id: String,
    json: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    let stream = state
        .terminals
        .lock()
        .await
        .get(&stream_id)
        .cloned()
        .ok_or_else(|| "terminal stream is closed".to_owned())?;
    stream.write(&json).await
}

#[tauri::command]
pub(crate) async fn native_terminal_detach(
    stream_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    let stream = state.terminals.lock().await.remove(&stream_id);
    if let Some(stream) = stream {
        stream.stop().await;
    }
    Ok(())
}

// Async commands run off the main thread, so the Android screen does not stop
// while the clipboard or the browser is reached. Terminal, Files and Git share them.
#[tauri::command]
pub(crate) async fn native_clipboard_read(app: AppHandle<Wry>) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|error| error.to_string())
}

// Text wins when the clipboard offers both text and an image.
#[tauri::command]
pub(crate) async fn native_clipboard_content(
    app: AppHandle<Wry>,
) -> Result<tauri::ipc::Response, String> {
    #[cfg(target_os = "android")]
    {
        use base64::Engine;
        use tauri_plugin_clipboard_image::{ClipboardContent, ClipboardImageExt};
        match app.clipboard_image().read_content().await? {
            ClipboardContent::Text { text } => Ok(tauri::ipc::Response::new(
                serde_json::json!({ "text": text }).to_string(),
            )),
            ClipboardContent::Image { data } => {
                let image = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|error| error.to_string())?;
                Ok(tauri::ipc::Response::new(image))
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        use image::ImageEncoder;
        // clipboard-manager converts arboard errors to strings. Match only
        // arboard::Error::ContentNotAvailable's Display, not access/conversion errors.
        let content_unavailable = |error: &tauri_plugin_clipboard_manager::Error| {
            matches!(error, tauri_plugin_clipboard_manager::Error::Clipboard(message)
                if message == "The clipboard contents were not available in the requested format or the clipboard is empty.")
        };
        match app.clipboard().read_text() {
            Ok(text) if !text.is_empty() => {
                return Ok(tauri::ipc::Response::new(
                    serde_json::json!({ "text": text }).to_string(),
                ));
            }
            Ok(_) => {}
            Err(error) if content_unavailable(&error) => {}
            Err(error) => return Err(error.to_string()),
        }
        let image = match app.clipboard().read_image() {
            Ok(image) => image,
            Err(error) if content_unavailable(&error) => {
                return Ok(tauri::ipc::Response::new(
                    serde_json::json!({ "text": "" }).to_string(),
                ));
            }
            Err(error) => return Err(error.to_string()),
        };
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(
                image.rgba(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| error.to_string())?;
        Ok(tauri::ipc::Response::new(png))
    }
}

#[tauri::command]
pub(crate) async fn native_clipboard_write(
    text: String,
    app: AppHandle<Wry>,
) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn native_open_url(url: String, app: AppHandle<Wry>) -> Result<(), String> {
    // Only the user's link gesture calls this; Terminal output and Markdown are
    // external input, so only web and mail links may invoke an OS app.
    let parsed = tauri::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("unsupported link".to_owned());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
mod file_manager {
    use std::{fs, path::Path};

    fn local_path(value: &str) -> Result<&Path, String> {
        let path = Path::new(value);
        if !path.is_absolute()
            || value.contains('\0')
            || value.starts_with("//")
            || value.starts_with(r"\\")
        {
            return Err("Expected an absolute local path".to_owned());
        }
        #[cfg(windows)]
        if !has_drive_root(value) {
            return Err("Expected an absolute local path".to_owned());
        }
        Ok(path)
    }

    #[cfg(any(windows, test))]
    fn has_drive_root(path: &str) -> bool {
        matches!(path.as_bytes(), [drive, b':', b'/' | b'\\', ..] if drive.is_ascii_alphabetic())
    }

    #[cfg(any(windows, test))]
    fn windows_shell_directory(path: &str) -> Result<String, String> {
        let path = path.strip_prefix(r"\\?\").unwrap_or(path);
        if !has_drive_root(path) {
            return Err("Expected an absolute local path".to_owned());
        }
        Ok(path.replace('/', r"\"))
    }

    #[cfg(any(windows, test))]
    fn windows_open_directory(
        path: &str,
        canonical: &str,
        is_real_directory: bool,
    ) -> Result<String, String> {
        windows_shell_directory(if is_real_directory { path } else { canonical })
    }

    fn is_macos_bundle(path: &Path) -> bool {
        path.extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                ["app", "pkg", "workflow", "action", "prefpane"]
                    .iter()
                    .any(|bundle| ext.eq_ignore_ascii_case(bundle))
            })
    }

    pub(super) fn reveal(
        path: &str,
        open_directory: bool,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        reveal_with(
            path,
            open_directory,
            |path| tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string()),
            open,
        )
    }

    fn reveal_with(
        path: &str,
        open_directory: bool,
        select: impl Fn(&Path) -> Result<(), String>,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        let path = local_path(path)?;
        let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        let is_real_directory = !metadata.file_type().is_symlink() && metadata.is_dir();
        let reveal_error = if open_directory {
            None
        } else {
            match select(path) {
                Ok(()) => return Ok(()),
                Err(error)
                    if !cfg!(target_os = "linux")
                        && !is_real_directory
                        && !fs::metadata(path).is_ok_and(|m| m.is_dir()) =>
                {
                    return Err(error);
                }
                Err(error) => Some(error),
            }
        };
        let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
        let directory = canonical.as_path();
        #[cfg(target_os = "linux")]
        let directory = if !open_directory && !canonical.is_dir() {
            canonical
                .parent()
                .filter(|parent| parent.is_dir())
                .ok_or("Expected a directory")?
        } else {
            directory
        };
        if !directory.is_dir() {
            return Err("Expected a directory".to_owned());
        }
        // Launch Services can run these directory bundles when opened normally.
        if cfg!(target_os = "macos") && is_macos_bundle(directory) {
            if let Some(error) = reveal_error {
                return Err(error);
            }
            return select(directory);
        }
        let directory = directory.to_str().ok_or("Invalid directory path")?;
        #[cfg(windows)]
        let directory = &windows_open_directory(
            path.to_str().ok_or("Invalid directory path")?,
            directory,
            is_real_directory,
        )?;
        open(directory)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn requires_an_absolute_local_path() {
            for value in [
                "",
                "file.txt",
                "C:file.txt",
                "//host/share",
                r"\\host\share",
            ] {
                assert!(local_path(value).is_err(), "{value:?}");
            }
            let absolute = if cfg!(windows) { r"C:\work" } else { "/work" };
            assert!(local_path(absolute).is_ok());
            assert!(local_path(&format!("{absolute}\0file")).is_err());
        }

        #[test]
        fn windows_shell_accepts_only_local_drive_paths() {
            for (value, expected) in [
                (r"\\?\C:\folder", r"C:\folder"),
                (r"\\?\z:/folder", r"z:\folder"),
                (r"D:\", r"D:\"),
            ] {
                assert_eq!(windows_shell_directory(value).unwrap(), expected);
            }
            for value in [
                r"\\?\UNC\host\share",
                r"\\.\C:\folder",
                r"\\host\share",
                "//host/share",
                r"\\?\C:relative",
            ] {
                assert!(windows_shell_directory(value).is_err(), "{value:?}");
            }
        }

        #[test]
        fn open_directory_rejects_a_regular_file() {
            let file = concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml");
            assert!(Path::new(file).is_file());
            assert!(reveal(file, true, |_| panic!("opened a regular file")).is_err());
        }

        #[cfg(target_os = "linux")]
        #[test]
        fn file_selection_failure_opens_its_parent_directory() {
            let file = concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml");
            let canonical = fs::canonicalize(file).unwrap();
            let parent = canonical.parent().unwrap();
            let mut opened = false;
            reveal_with(
                file,
                false,
                |_| Err("Selection unavailable".to_owned()),
                |directory| {
                    assert_eq!(Path::new(directory), parent);
                    opened = true;
                    Ok(())
                },
            )
            .unwrap();
            assert!(opened);
        }

        #[test]
        fn windows_directory_open_preserves_mapped_drive_but_checks_symlink_target() {
            let mapped = r"Z:\repo";
            let canonical = r"\\?\UNC\host\share\repo";
            assert_eq!(
                windows_open_directory(mapped, canonical, true).unwrap(),
                mapped
            );
            assert!(windows_open_directory(mapped, canonical, false).is_err());
        }

        #[test]
        fn identifies_macos_bundles_for_selection_in_finder() {
            for name in [
                "Demo.APP",
                "Setup.pkg",
                "Demo.workflow",
                "Demo.action",
                "Demo.prefPane",
            ] {
                assert!(is_macos_bundle(Path::new(name)), "{name}");
            }
            assert!(!is_macos_bundle(Path::new("Demo.app/Contents")));
            assert!(!is_macos_bundle(Path::new("Demo.application-data")));
        }
    }
}

#[tauri::command]
pub(crate) async fn native_reveal_in_file_manager(
    path: String,
    open_directory: Option<bool>,
    app: AppHandle<Wry>,
) -> Result<(), String> {
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            file_manager::reveal(&path, open_directory.unwrap_or(false), |directory| {
                app.opener()
                    .open_path(directory, None::<&str>)
                    .map_err(|error| error.to_string())
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (path, open_directory, app);
        Err("unsupported".to_owned())
    }
}

#[tauri::command]
pub(crate) async fn native_open_windows_optional_features(
    app: AppHandle<Wry>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        app.opener()
            .open_url("ms-settings:optionalfeatures", None::<&str>)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Windows settings are only available on Windows".to_owned())
    }
}

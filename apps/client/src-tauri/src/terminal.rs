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

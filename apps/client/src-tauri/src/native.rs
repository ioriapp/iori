#[cfg(target_os = "linux")]
mod linux_storage;
mod storage;
mod transport;
use iroh::SecretKey;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64},
    },
};
use storage::ClientDatabase;
use tauri::{
    AppHandle, Manager, State, Wry,
    plugin::{Builder, TauriPlugin},
};
#[cfg(target_os = "android")]
use tauri::{Emitter, plugin::PluginHandle};
#[cfg(windows)]
pub(crate) use transport::MAX_FRAME_BYTES;
use transport::{ConnectionResponse, SubscriptionResponse};
pub(crate) use transport::{get_connection, read_frame, write_frame};
#[cfg(target_os = "linux")]
use zeroize::Zeroizing;
static NEXT_NATIVE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostInfo {
    #[serde(flatten)]
    metadata: HostMetadata,
    relay: Option<RelaySettings>,
}

// Only these registration fields may be written to the plaintext SQLite tables.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_scope: Option<String>,
    public_key: String,
    host_name: String,
    #[serde(default)]
    ssh_destination: Option<String>,
    addresses: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelaySettings {
    url: String,
    token: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitialState {
    public_key: String,
    device_name: String,
    language: String,
    can_scan_qr: bool,
    mobile: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_os: Option<&'static str>,
    can_setup_host: bool,
    can_close_to_exit: bool,
    hosts: Vec<HostInfo>,
    active_host_key: Option<String>,
}

struct PlatformIdentity {
    secret_key: SecretKey,
    device_name: String,
    language: String,
    can_scan_qr: bool,
}

pub(crate) struct NativeState {
    secret_key: SecretKey,
    public_key: String,
    device_name: String,
    language: String,
    can_scan_qr: bool,
    database: ClientDatabase,
    pub(crate) terminals:
        tauri::async_runtime::Mutex<HashMap<String, Arc<crate::terminal::TerminalStream>>>,
    endpoint: tauri::async_runtime::Mutex<transport::RelayEndpoint>,
    connections: tauri::async_runtime::Mutex<transport::ConnectionTable>,
    connect_gates: StdMutex<HashMap<String, Arc<tauri::async_runtime::Mutex<()>>>>,
    stream_stops: Arc<tauri::async_runtime::Mutex<transport::StreamStops>>,
}

impl NativeState {
    fn new(identity: PlatformIdentity, database: ClientDatabase) -> Self {
        let public_key = encode_hex(identity.secret_key.public().as_bytes());
        Self {
            secret_key: identity.secret_key,
            public_key,
            device_name: identity.device_name,
            language: identity.language,
            can_scan_qr: identity.can_scan_qr,
            database,
            terminals: tauri::async_runtime::Mutex::new(HashMap::new()),
            endpoint: Default::default(),
            connections: Default::default(),
            connect_gates: StdMutex::new(HashMap::new()),
            stream_stops: Default::default(),
        }
    }
}

pub(crate) struct NativeContext {
    app: AppHandle<Wry>,
    #[cfg(target_os = "android")]
    android_plugin: Result<PluginHandle<Wry>, String>,
    initialized: tauri::async_runtime::Mutex<Option<Arc<NativeState>>>,
    registration_reset_allowed: AtomicBool,
    #[cfg(target_os = "linux")]
    storage_key: tauri::async_runtime::Mutex<Option<Zeroizing<[u8; 32]>>>,
}

impl NativeContext {
    #[cfg(target_os = "android")]
    pub(crate) fn delete_saved_document(&self, uri: &str) -> Result<(), String> {
        self.android_plugin
            .as_ref()
            .map_err(|error| error.clone())?
            .run_mobile_plugin::<serde_json::Value>(
                "deleteSavedDocument",
                serde_json::json!({ "value": uri }),
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn new(
        app: AppHandle<Wry>,
        #[cfg(target_os = "android")] android_plugin: Result<PluginHandle<Wry>, String>,
    ) -> Self {
        Self {
            app,
            #[cfg(target_os = "android")]
            android_plugin,
            initialized: tauri::async_runtime::Mutex::new(None),
            registration_reset_allowed: AtomicBool::new(false),
            #[cfg(target_os = "linux")]
            storage_key: tauri::async_runtime::Mutex::new(None),
        }
    }
}

/// A View's saved state, encrypted with the OS-protected key like the layout.
#[tauri::command]
pub(crate) async fn native_load_view(
    scope: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<Option<serde_json::Value>, String> {
    context.load_view(&format!("view:{scope}")).await
}

#[tauri::command]
pub(crate) async fn native_save_view(
    scope: String,
    value: serde_json::Value,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    context.save_view(&format!("view:{scope}"), value).await
}

#[tauri::command]
pub(crate) async fn native_load_workspace_layout(
    scope_key: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<Option<serde_json::Value>, String> {
    context.load_view(&format!("workspace:{scope_key}")).await
}

#[tauri::command]
pub(crate) async fn native_save_workspace_layout(
    scope_key: String,
    layout: serde_json::Value,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    context
        .save_view(&format!("workspace:{scope_key}"), layout)
        .await
}

#[tauri::command]
pub(crate) async fn native_load_client_preferences(
    context: State<'_, Arc<NativeContext>>,
) -> Result<Option<serde_json::Value>, String> {
    context.load_view("preferences").await
}

#[tauri::command]
pub(crate) async fn native_save_client_preferences(
    preferences: serde_json::Value,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    context.save_view("preferences", preferences).await
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("iori-native")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let android_plugin = api
                .register_android_plugin("io.github.ioriapp.iori", "IoriNativePlugin")
                .map_err(|error| error.to_string());
            #[cfg(target_os = "android")]
            if let Ok(plugin) = &android_plugin {
                let handle = app.clone();
                let channel = tauri::ipc::Channel::<serde_json::Value>::new(move |body| {
                    if let tauri::ipc::InvokeResponseBody::Json(payload) = body {
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&payload) {
                            let _ = handle.emit("native://unifiedpush", event);
                        }
                    }
                    Ok(())
                });
                plugin
                    .run_mobile_plugin::<()>(
                        "registerListener",
                        serde_json::json!({
                            "event": "unifiedpush", "handler": channel
                        }),
                    )
                    .map_err(|error| error.to_string())?;
            }
            #[cfg(not(target_os = "android"))]
            let _ = api;
            app.manage(Arc::new(NativeContext::new(
                app.clone(),
                #[cfg(target_os = "android")]
                android_plugin,
            )));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub(crate) async fn native_reset_registration(
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    context.reset_registration().await
}

#[tauri::command]
pub(crate) async fn native_initial_state(
    context: State<'_, Arc<NativeContext>>,
) -> Result<InitialState, String> {
    let state = context.native_state().await?;
    let registered = state.database.hosts()?;
    let hosts = {
        let endpoint = state.endpoint.lock().await;
        registered
            .into_iter()
            .map(|metadata| {
                let relay = endpoint
                    .hosts
                    .iter()
                    .find(|(key, _)| key == &metadata.public_key)
                    .map(|(_, relay)| relay.clone());
                HostInfo { metadata, relay }
            })
            .collect()
    };
    Ok(InitialState {
        public_key: state.public_key.clone(),
        device_name: state.device_name.clone(),
        language: state.language.clone(),
        can_scan_qr: state.can_scan_qr,
        mobile: cfg!(mobile),
        #[cfg(windows)]
        client_os: Some("windows"),
        #[cfg(target_os = "macos")]
        client_os: Some("macos"),
        #[cfg(target_os = "linux")]
        client_os: Some("linux"),
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        client_os: None,
        can_setup_host: cfg!(any(windows, target_os = "linux")),
        can_close_to_exit: cfg!(windows),
        hosts,
        active_host_key: state.database.active_host_key()?,
    })
}

#[tauri::command]
pub(crate) async fn native_save_host(
    host: HostInfo,
    select: bool,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    state.database.save_host(&host.metadata, select)?;
    let mut endpoint = state.endpoint.lock().await;
    let previous = endpoint
        .hosts
        .iter()
        .find(|(key, _)| key == &host.metadata.public_key)
        .map(|(_, relay)| relay);
    if previous == host.relay.as_ref() {
        return Ok(());
    }
    let mut hosts = endpoint.hosts.clone();
    hosts.retain(|(key, _)| key != &host.metadata.public_key);
    if let Some(relay) = host.relay {
        hosts.push((host.metadata.public_key, relay));
    }
    context.save_relays(&state.database, &hosts).await?;
    endpoint.hosts = hosts;
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_connect(
    public_key: String,
    addresses: Vec<String>,
    relay: Option<RelaySettings>,
    app: AppHandle<Wry>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<ConnectionResponse, String> {
    transport::connect(
        public_key,
        addresses,
        relay,
        app,
        context.native_state().await?,
    )
    .await
}

#[tauri::command]
pub(crate) async fn native_request(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<String, String> {
    transport::request(
        connection_id,
        json,
        cancel_key,
        context.native_state().await?,
    )
    .await
}

#[tauri::command]
pub(crate) async fn native_subscribe(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    app: AppHandle<Wry>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<SubscriptionResponse, String> {
    transport::subscribe(
        connection_id,
        json,
        cancel_key,
        app,
        context.native_state().await?,
    )
    .await
}

#[tauri::command]
pub(crate) async fn native_cancel_stream(
    stream_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    transport::cancel_stream(stream_id, context.native_state().await?).await
}

#[tauri::command]
pub(crate) async fn native_disconnect(
    connection_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    transport::disconnect(connection_id, context.native_state().await?).await
}

#[tauri::command]
pub(crate) async fn native_back_default(
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = context
            .android_plugin
            .as_ref()
            .map_err(|error| error.clone())?;
        let _: serde_json::Value = plugin
            .run_mobile_plugin_async("defaultBack", serde_json::json!({}))
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = context;
        Ok(())
    }
}

/// Opens the on-screen keyboard for the focused text field (Android only).
#[tauri::command]
pub(crate) async fn native_show_keyboard(
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = context
            .android_plugin
            .as_ref()
            .map_err(|error| error.clone())?;
        let _: serde_json::Value = plugin
            .run_mobile_plugin_async("showKeyboard", serde_json::json!({}))
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = context;
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn native_scan_qr(
    context: State<'_, Arc<NativeContext>>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Deserialize)]
        struct ScanResponse {
            value: String,
        }
        let android_plugin = context
            .android_plugin
            .as_ref()
            .map_err(|error| error.clone())?;
        return android_plugin
            .run_mobile_plugin_async("scanQr", serde_json::json!({}))
            .await
            .map(|response: ScanResponse| response.value)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = context;
        Err("QR scanning is available on Android only".to_owned())
    }
}

fn decode_hex(input: &str) -> Result<Vec<u8>, String> {
    if !input.len().is_multiple_of(2) {
        return Err("hex value has an odd number of characters".to_owned());
    }
    input
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| {
            let high = hex_nibble(pair[0])?;
            let low = hex_nibble(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err("hex value contains a non-hexadecimal character".to_owned()),
    }
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.as_ref().len() * 2);
    for byte in bytes.as_ref() {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

#[tauri::command]
pub(crate) async fn native_background_connection(
    enabled: bool,
    title: String,
    body: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = context
            .android_plugin
            .as_ref()
            .map_err(|error| error.clone())?;
        let _: serde_json::Value = plugin
            .run_mobile_plugin_async(
                "backgroundConnection",
                serde_json::json!({ "enabled": enabled, "title": title, "body": body }),
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = (enabled, title, body, context);
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_unifiedpush_distributors(
    context: State<'_, Arc<NativeContext>>,
) -> Result<serde_json::Value, String> {
    let value =
        android_native_call(&context, "unifiedPushDistributors", serde_json::json!({})).await?;
    Ok(value
        .get("distributors")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([])))
}

#[tauri::command]
pub(crate) async fn native_unifiedpush_register(
    distributor: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    android_native_call(
        &context,
        "unifiedPushRegister",
        serde_json::json!({ "distributor": distributor }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_unifiedpush_unregister(
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    android_native_call(&context, "unifiedPushUnregister", serde_json::json!({})).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_unifiedpush_state(
    events: Option<bool>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<serde_json::Value, String> {
    android_native_call(
        &context,
        "unifiedPushState",
        serde_json::json!({ "events": events }),
    )
    .await
}

async fn android_native_call(
    context: &NativeContext,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        context
            .android_plugin
            .as_ref()
            .map_err(|error| error.clone())?
            .run_mobile_plugin_async(command, args)
            .await
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (context, command, args);
        Ok(serde_json::json!({}))
    }
}

pub(crate) async fn notification_ready(app: &AppHandle) -> Result<(), String> {
    let context = app.state::<Arc<NativeContext>>();
    android_native_call(&context, "notificationReady", serde_json::json!({})).await?;
    Ok(())
}

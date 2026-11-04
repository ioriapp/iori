#[cfg(target_os = "linux")]
mod linux_storage;
use futures_lite::Stream;
use std::{
    collections::{HashMap, HashSet},
    net::{SocketAddr, ToSocketAddrs},
    path::Path,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicU64, Ordering},
    },
};

use iori_iroh_config::{ALPN, endpoint_builder};
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey, endpoint::Connection};
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    AppHandle, Emitter, Manager, State, Wry,
    plugin::{Builder, TauriPlugin},
};
use zeroize::Zeroizing;

pub(crate) const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const DATABASE_FILE: &str = "registrations.sqlite3";
static NEXT_NATIVE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostInfo {
    public_key: String,
    host_name: String,
    #[serde(default)]
    ssh_destination: Option<String>,
    addresses: Vec<String>,
    relay: Option<RelaySettings>,
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
    can_setup_host: bool,
    can_close_to_exit: bool,
    hosts: Vec<HostInfo>,
    active_host_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionResponse {
    connection_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionResponse {
    subscription_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    connection_id: String,
    subscription_id: String,
    json: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionEndedEvent {
    connection_id: String,
    subscription_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectedEvent {
    connection_id: String,
    reason: String,
}

pub(crate) enum FrameReadError {
    TooLarge,
    Other(String),
}

impl std::fmt::Display for FrameReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => write!(
                formatter,
                "received frame exceeds the {MAX_FRAME_BYTES}-byte limit"
            ),
            Self::Other(reason) => formatter.write_str(reason),
        }
    }
}

struct PlatformIdentity {
    secret_key: SecretKey,
    device_name: String,
    language: String,
    can_scan_qr: bool,
}

// Ordered by receipt of a changed Host setting. A relay accepts one active
// connection per endpoint identity, so every Host uses the same Client endpoint.
#[derive(Default)]
struct RelayEndpoint {
    endpoint: Option<Endpoint>,
    hosts: Vec<(String, RelaySettings)>,
    applied: Vec<RelaySettings>,
}

impl RelayEndpoint {
    fn configuration(&self, host_key: &str, relay: Option<&RelaySettings>) -> Vec<RelaySettings> {
        let previous = self
            .hosts
            .iter()
            .find(|(key, _)| key == host_key)
            .map(|(_, settings)| settings);
        let changed = previous != relay;
        let mut relays = std::collections::BTreeMap::new();
        for (key, settings) in &self.hosts {
            if !changed || key != host_key {
                relays.insert(settings.url.clone(), settings.clone());
            }
        }
        if changed && let Some(settings) = relay {
            relays.insert(settings.url.clone(), settings.clone());
        }
        relays.into_values().collect()
    }
}

struct ConnectionEntry {
    host_key: String,
    connection: Connection,
}

#[derive(Default)]
struct ConnectionTable {
    by_id: HashMap<String, ConnectionEntry>,
    by_host: HashMap<String, String>,
}

pub(crate) struct NativeState {
    secret_key: SecretKey,
    public_key: String,
    device_name: String,
    language: String,
    can_scan_qr: bool,
    pub(crate) database: StdMutex<SqliteConnection>,
    pub(crate) terminals:
        tauri::async_runtime::Mutex<HashMap<String, Arc<crate::terminal::TerminalStream>>>,
    endpoint: tauri::async_runtime::Mutex<RelayEndpoint>,
    connections: tauri::async_runtime::Mutex<ConnectionTable>,
    connect_gates: StdMutex<HashMap<String, Arc<tauri::async_runtime::Mutex<()>>>>,
    stream_stops: Arc<tauri::async_runtime::Mutex<StreamStops>>,
}

// Cancels for keys not registered yet; the WebView may cancel before the request reaches Rust.
const EARLY_CANCELS: usize = 64;

/// Stop handles of cancellable streams, keyed by the WebView's cancel key.
#[derive(Default)]
pub(crate) struct StreamStops {
    stops: HashMap<String, tokio::sync::oneshot::Sender<()>>,
    early: std::collections::VecDeque<String>,
}

impl StreamStops {
    /// Registers a stream; `None` when its cancel already arrived.
    fn register(&mut self, key: &str) -> Option<tokio::sync::oneshot::Receiver<()>> {
        if let Some(index) = self.early.iter().position(|value| value == key) {
            self.early.remove(index);
            return None;
        }
        let (stop, stopped) = tokio::sync::oneshot::channel();
        self.stops.insert(key.to_owned(), stop);
        Some(stopped)
    }

    fn cancel(&mut self, key: &str) {
        if let Some(stop) = self.stops.remove(key) {
            let _ = stop.send(());
            return;
        }
        self.early.push_back(key.to_owned());
        while self.early.len() > EARLY_CANCELS {
            self.early.pop_front();
        }
    }

    fn remove(&mut self, key: &str) {
        self.stops.remove(key);
    }
}

impl NativeState {
    fn new(identity: PlatformIdentity, database: SqliteConnection) -> Self {
        let public_key = encode_hex(identity.secret_key.public().as_bytes());
        Self {
            secret_key: identity.secret_key,
            public_key,
            device_name: identity.device_name,
            language: identity.language,
            can_scan_qr: identity.can_scan_qr,
            database: StdMutex::new(database),
            terminals: tauri::async_runtime::Mutex::new(HashMap::new()),
            endpoint: tauri::async_runtime::Mutex::new(RelayEndpoint::default()),
            connections: tauri::async_runtime::Mutex::new(ConnectionTable::default()),
            connect_gates: StdMutex::new(HashMap::new()),
            stream_stops: Arc::new(tauri::async_runtime::Mutex::new(StreamStops::default())),
        }
    }

    fn hosts(&self) -> Result<Vec<HostInfo>, String> {
        let database = self
            .database
            .lock()
            .map_err(|_| "registration database is unavailable".to_owned())?;
        let mut statement = database
            .prepare("SELECT hosts.public_key, host_name, addresses_json, host_setup.destination FROM hosts LEFT JOIN host_setup ON host_setup.public_key = hosts.public_key ORDER BY hosts.rowid")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                let addresses_json: String = row.get(2)?;
                let addresses = serde_json::from_str(&addresses_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(HostInfo {
                    public_key: row.get(0)?,
                    host_name: row.get(1)?,
                    ssh_destination: row.get(3)?,
                    addresses,
                    relay: None,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect()
    }

    fn active_host_key(&self) -> Result<Option<String>, String> {
        self.database
            .lock()
            .map_err(|_| "registration database is unavailable".to_owned())?
            .query_row(
                "SELECT public_key FROM active_host WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn save_host(&self, host: &HostInfo, select: bool) -> Result<(), String> {
        let addresses_json =
            serde_json::to_string(&host.addresses).map_err(|error| error.to_string())?;
        let mut database = self
            .database
            .lock()
            .map_err(|_| "registration database is unavailable".to_owned())?;
        let transaction = database.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO hosts (public_key, host_name, addresses_json) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(public_key) DO UPDATE SET host_name = excluded.host_name, addresses_json = excluded.addresses_json",
                params![host.public_key, host.host_name, addresses_json],
            )
            .map_err(|error| error.to_string())?;
        if let Some(destination) = &host.ssh_destination {
            transaction.execute("INSERT INTO host_setup (public_key, destination) VALUES (?1, ?2) ON CONFLICT(public_key) DO UPDATE SET destination = excluded.destination", params![host.public_key, destination]).map_err(|error| error.to_string())?;
        }
        if select {
            transaction
                .execute(
                    "INSERT INTO active_host (singleton, public_key) VALUES (1, ?1) \
                 ON CONFLICT(singleton) DO UPDATE SET public_key = excluded.public_key",
                    params![host.public_key],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    fn connection_gate(
        &self,
        host_key: &str,
    ) -> Result<Arc<tauri::async_runtime::Mutex<()>>, String> {
        let mut gates = self
            .connect_gates
            .lock()
            .map_err(|_| "connection state is unavailable".to_owned())?;
        Ok(gates
            .entry(host_key.to_owned())
            .or_insert_with(|| Arc::new(tauri::async_runtime::Mutex::new(())))
            .clone())
    }

    fn stored_view(&self, scope: &str) -> Result<Option<Vec<u8>>, String> {
        self.database
            .lock()
            .map_err(|_| "view database is unavailable".to_owned())?
            .query_row(
                "SELECT ciphertext FROM client_views WHERE scope = ?1",
                params![scope],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn save_view(&self, scope: &str, ciphertext: &[u8]) -> Result<(), String> {
        self.database
            .lock()
            .map_err(|_| "view database is unavailable".to_owned())?
            .execute(
                "INSERT INTO client_views (scope, ciphertext) VALUES (?1, ?2) \
                 ON CONFLICT(scope) DO UPDATE SET ciphertext = excluded.ciphertext",
                params![scope, ciphertext],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn endpoint(
        &self,
        host_key: &str,
        relay: Option<RelaySettings>,
    ) -> Result<Endpoint, String> {
        let mut current = self.endpoint.lock().await;
        let settings = current.configuration(host_key, relay.as_ref());
        if current.applied == settings
            && let Some(endpoint) = &current.endpoint
        {
            return Ok(endpoint.clone());
        }
        let configs = settings
            .iter()
            .map(|relay| iori_iroh_config::relay_config(&relay.url, relay.token.as_deref()))
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(old) = current.endpoint.take() {
            old.close().await;
        }

        let ipv4 = SocketAddr::from(([0, 0, 0, 0], 0));
        let ipv6 = SocketAddr::from(([0u16; 8], 0));
        let builder = endpoint_builder(self.secret_key.clone(), &[ipv4, ipv6], configs.clone())
            .map_err(|error| error.to_string())?;
        let bound = match builder.bind().await {
            Ok(endpoint) => endpoint,
            Err(ipv6_error) => {
                let builder = endpoint_builder(self.secret_key.clone(), &[ipv4], configs)
                    .map_err(|error| error.to_string())?;
                builder.bind().await.map_err(|ipv4_error| {
                    format!("could not bind a network endpoint: {ipv4_error}; IPv6 attempt: {ipv6_error}")
                })?
            }
        };
        current.endpoint = Some(bound.clone());
        current.applied = settings;
        Ok(bound)
    }
}

pub(crate) struct NativeContext {
    app: AppHandle<Wry>,
    #[cfg(target_os = "android")]
    android_plugin: Result<PluginHandle<Wry>, String>,
    initialized: tauri::async_runtime::Mutex<Option<Arc<NativeState>>>,
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
            #[cfg(target_os = "linux")]
            storage_key: tauri::async_runtime::Mutex::new(None),
        }
    }

    pub(crate) async fn native_state(&self) -> Result<Arc<NativeState>, String> {
        let mut initialized = self.initialized.lock().await;
        if let Some(state) = initialized.as_ref() {
            return Ok(state.clone());
        }

        let app_data_dir = self
            .app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&app_data_dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        }
        let identity = self.platform_identity(&app_data_dir).await?;
        let database = open_database(&app_data_dir)?;
        let state = Arc::new(NativeState::new(identity, database));
        if let Ok(Some(ciphertext)) = state.stored_view("host-relays")
            && let Ok(plaintext) = self.unprotect_view(&ciphertext).await
            && let Ok(hosts) = serde_json::from_str(&plaintext)
        {
            state.endpoint.lock().await.hosts = hosts;
        }
        *initialized = Some(state.clone());
        Ok(state)
    }

    async fn platform_identity(&self, _app_data_dir: &Path) -> Result<PlatformIdentity, String> {
        #[cfg(target_os = "windows")]
        {
            let secret_key =
                load_or_create_windows_identity(&_app_data_dir.join("client-key.dpapi"))?;
            return Ok(PlatformIdentity {
                secret_key,
                device_name: std::env::var("COMPUTERNAME")
                    .ok()
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| "Windows".to_owned()),
                language: sys_locale::get_locale().unwrap_or_else(|| "en-US".to_owned()),
                can_scan_qr: false,
            });
        }

        #[cfg(target_os = "android")]
        {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct IdentityResponse {
                secret_hex: String,
                device_name: String,
                language: String,
                can_scan_qr: bool,
            }

            let android_plugin = self
                .android_plugin
                .as_ref()
                .map_err(|error| error.clone())?;
            let mut identity: IdentityResponse = android_plugin
                .run_mobile_plugin_async("getIdentity", serde_json::json!({}))
                .await
                .map_err(|error| error.to_string())?;
            let secret_hex = Zeroizing::new(std::mem::take(&mut identity.secret_hex));
            let bytes = decode_hex(&secret_hex)?;
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "Android identity secret must be 32 bytes".to_owned())?;
            let bytes = Zeroizing::new(bytes);
            return Ok(PlatformIdentity {
                secret_key: SecretKey::from_bytes(&bytes),
                device_name: identity.device_name,
                language: identity.language,
                can_scan_qr: identity.can_scan_qr,
            });
        }

        #[cfg(target_os = "linux")]
        {
            let (secret_key, key) =
                linux_storage::identity(&self.app.config().identifier, _app_data_dir).await?;
            *self.storage_key.lock().await = Some(key);
            Ok(PlatformIdentity {
                secret_key,
                device_name: std::fs::read_to_string("/etc/hostname")
                    .map(|name| name.trim().to_owned())
                    .unwrap_or_else(|_| "Linux".into()),
                language: sys_locale::get_locale().unwrap_or_else(|| "en-US".into()),
                can_scan_qr: false,
            })
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
        {
            let _ = _app_data_dir;
            Err("Client identity storage is supported on Windows and Android".to_owned())
        }
    }

    async fn protect_view(&self, plaintext: &str) -> Result<Vec<u8>, String> {
        #[cfg(target_os = "windows")]
        {
            dpapi_protect(plaintext.as_bytes())
        }
        #[cfg(target_os = "android")]
        {
            #[derive(Deserialize)]
            struct ProtectedView {
                value: String,
            }
            let plugin = self
                .android_plugin
                .as_ref()
                .map_err(|error| error.clone())?;
            let response: ProtectedView = plugin
                .run_mobile_plugin_async("protectView", serde_json::json!({ "value": plaintext }))
                .await
                .map_err(|error| error.to_string())?;
            decode_hex(&response.value)
        }
        #[cfg(target_os = "linux")]
        {
            let key = self.storage_key.lock().await;
            linux_storage::protect(
                key.as_ref().ok_or("Client storage key unavailable")?,
                plaintext,
            )
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
        {
            let _ = plaintext;
            Err("Client view storage is supported on Windows and Android".to_owned())
        }
    }

    async fn unprotect_view(&self, ciphertext: &[u8]) -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            let plaintext = Zeroizing::new(dpapi_unprotect(ciphertext)?);
            String::from_utf8(plaintext.to_vec()).map_err(|error| error.to_string())
        }
        #[cfg(target_os = "android")]
        {
            #[derive(Deserialize)]
            struct PlainView {
                value: String,
            }
            let plugin = self
                .android_plugin
                .as_ref()
                .map_err(|error| error.clone())?;
            let response: PlainView = plugin
                .run_mobile_plugin_async(
                    "unprotectView",
                    serde_json::json!({ "value": encode_hex(ciphertext) }),
                )
                .await
                .map_err(|error| error.to_string())?;
            Ok(response.value)
        }
        #[cfg(target_os = "linux")]
        {
            let key = self.storage_key.lock().await;
            linux_storage::unprotect(
                key.as_ref().ok_or("Client storage key unavailable")?,
                ciphertext,
            )
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
        {
            let _ = ciphertext;
            Err("Client view storage is supported on Windows and Android".to_owned())
        }
    }

    async fn load_view(&self, scope: &str) -> Result<Option<serde_json::Value>, String> {
        let state = self.native_state().await?;
        let Some(ciphertext) = state.stored_view(scope)? else {
            return Ok(None);
        };
        let plaintext = self.unprotect_view(&ciphertext).await?;
        serde_json::from_str(&plaintext)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    async fn save_view(&self, scope: &str, value: serde_json::Value) -> Result<(), String> {
        let state = self.native_state().await?;
        let plaintext = serde_json::to_string(&value).map_err(|error| error.to_string())?;
        let ciphertext = self.protect_view(&plaintext).await?;
        state.save_view(scope, &ciphertext)
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
pub(crate) async fn native_initial_state(
    context: State<'_, Arc<NativeContext>>,
) -> Result<InitialState, String> {
    let state = context.native_state().await?;
    let mut hosts = state.hosts()?;
    {
        let endpoint = state.endpoint.lock().await;
        for host in &mut hosts {
            host.relay = endpoint
                .hosts
                .iter()
                .find(|(key, _)| key == &host.public_key)
                .map(|(_, relay)| relay.clone());
        }
    }
    Ok(InitialState {
        public_key: state.public_key.clone(),
        device_name: state.device_name.clone(),
        language: state.language.clone(),
        can_scan_qr: state.can_scan_qr,
        mobile: cfg!(mobile),
        can_setup_host: cfg!(any(windows, target_os = "linux")),
        can_close_to_exit: cfg!(windows),
        hosts,
        active_host_key: state.active_host_key()?,
    })
}

#[tauri::command]
pub(crate) async fn native_save_host(
    host: HostInfo,
    select: bool,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    state.save_host(&host, select)?;
    let mut endpoint = state.endpoint.lock().await;
    let previous = endpoint
        .hosts
        .iter()
        .find(|(key, _)| key == &host.public_key)
        .map(|(_, relay)| relay);
    if previous == host.relay.as_ref() {
        return Ok(());
    }
    let mut hosts = endpoint.hosts.clone();
    hosts.retain(|(key, _)| key != &host.public_key);
    if let Some(relay) = host.relay {
        hosts.push((host.public_key, relay));
    }
    let plaintext =
        serde_json::to_string(&hosts).map_err(|_| "could not save Relay settings".to_owned())?;
    let ciphertext = context.protect_view(&plaintext).await?;
    state.save_view("host-relays", &ciphertext)?;
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
    let state = context.native_state().await?;
    let gate = state.connection_gate(&public_key)?;
    let _gate = gate.lock().await;

    {
        let mut connections = state.connections.lock().await;
        if let Some(connection_id) = connections.by_host.get(&public_key).cloned() {
            if connections
                .by_id
                .get(&connection_id)
                .is_some_and(|entry| entry.connection.close_reason().is_none())
            {
                return Ok(ConnectionResponse { connection_id });
            }
            connections.by_host.remove(&public_key);
            connections.by_id.remove(&connection_id);
        }
    }

    let peer_id = parse_public_key(&public_key)?;
    let allow_relay = relay.is_some();
    let resolved_addresses =
        tauri::async_runtime::spawn_blocking(move || resolve_addresses(&addresses, allow_relay))
            .await
            .map_err(|error| error.to_string())??;
    let mut peer = EndpointAddr::from(peer_id);
    for address in resolved_addresses {
        peer = peer.with_ip_addr(address);
    }

    if let Some(relay) = &relay {
        peer = peer.with_relay_url(
            relay
                .url
                .parse()
                .map_err(|_| "invalid Relay URL".to_owned())?,
        );
    }
    let relay_token = relay.as_ref().and_then(|relay| relay.token.clone());
    let endpoint = state.endpoint(&public_key, relay).await?;
    let connection = endpoint.connect(peer, ALPN).await.map_err(|error| {
        let message = error.to_string();
        let safe = relay_token.as_deref().map_or_else(
            || message.clone(),
            |token| message.replace(token, "[token removed]"),
        );
        eprintln!(
            "[connection] native_connect failed: {}",
            safe.replace(['\r', '\n'], " ")
        );
        message
    })?;
    if connection.remote_id() != peer_id {
        connection.close(0_u32.into(), b"unexpected endpoint identity");
        return Err("the Host endpoint identity did not match the invitation".to_owned());
    }

    let connection_id = next_native_id("connection");
    let entry_connection = connection.clone();
    {
        let mut connections = state.connections.lock().await;
        connections
            .by_host
            .insert(public_key.clone(), connection_id.clone());
        connections.by_id.insert(
            connection_id.clone(),
            ConnectionEntry {
                host_key: public_key,
                connection: entry_connection.clone(),
            },
        );
    }

    let path_connection = entry_connection.clone();
    let path_app = app.clone();
    let path_id = connection_id.clone();
    let path_host = {
        let connections = state.connections.lock().await;
        connections
            .by_id
            .get(&connection_id)
            .expect("connection inserted")
            .host_key
            .clone()
    };
    tauri::async_runtime::spawn(async move {
        let mut paths = std::pin::pin!(path_connection.paths_stream());
        while let Some(paths) =
            std::future::poll_fn(|cx| std::pin::Pin::as_mut(&mut paths).poll_next(cx)).await
        {
            let route = paths
                .iter()
                .find(|path| path.is_selected())
                .map(|path| if path.is_relay() { "relay" } else { "direct" });
            let _ = path_app.emit("native://connection-route", serde_json::json!({ "hostKey": path_host, "connectionId": path_id, "route": route }));
        }
    });

    let app_for_close = app.clone();
    let state_for_close = state.clone();
    let host_key = {
        let connections = state.connections.lock().await;
        connections
            .by_id
            .get(&connection_id)
            .map(|entry| entry.host_key.clone())
            .ok_or_else(|| "connection state is unavailable".to_owned())?
    };
    let watch_id = connection_id.clone();
    tauri::async_runtime::spawn(async move {
        let close_reason = entry_connection.closed().await;
        let reason = connection_close_reason(close_reason);
        let should_notify = {
            let mut connections = state_for_close.connections.lock().await;
            let is_current = connections
                .by_host
                .get(&host_key)
                .is_some_and(|current_id| current_id == &watch_id);
            if is_current {
                connections.by_host.remove(&host_key);
                connections.by_id.remove(&watch_id);
            }
            is_current
        };
        if should_notify {
            let _ = app_for_close.emit(
                "native://disconnected",
                DisconnectedEvent {
                    connection_id: watch_id,
                    reason,
                },
            );
        }
    });

    Ok(ConnectionResponse { connection_id })
}

#[tauri::command]
pub(crate) async fn native_request(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<String, String> {
    let state = context.native_state().await?;
    let connection = get_connection(&state, &connection_id).await?;
    // The cancel handle exists before the stream is opened, so a cancel that
    // arrives while the request is still being sent also stops it.
    let stopped = match &cancel_key {
        Some(key) => match state.stream_stops.lock().await.register(key) {
            Some(stopped) => Some(stopped),
            None => return Err("read cancelled".to_owned()),
        },
        None => None,
    };
    let exchange = async {
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| FrameReadError::Other(error.to_string()))?;
        write_frame(&mut send, json.as_bytes())
            .await
            .map_err(FrameReadError::Other)?;
        send.finish()
            .map_err(|error| FrameReadError::Other(error.to_string()))?;
        read_frame(&mut receive).await
    };
    let response = match stopped {
        Some(stopped) => {
            // Dropping the exchange drops its streams, which stops the Host's side.
            let result = tokio::select! {
                result = exchange => result,
                _ = stopped => Err(FrameReadError::Other("read cancelled".to_owned())),
            };
            if let Some(key) = &cancel_key {
                state.stream_stops.lock().await.remove(key);
            }
            result
        }
        None => exchange.await,
    };
    match response {
        Ok(Some(response)) => Ok(response),
        Ok(None) => Err("the response stream ended before a frame arrived".to_owned()),
        Err(error @ FrameReadError::TooLarge) => {
            connection.close(0_u32.into(), b"frame exceeds 4 MiB limit");
            Err(error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub(crate) async fn native_subscribe(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    app: AppHandle<Wry>,
    context: State<'_, Arc<NativeContext>>,
) -> Result<SubscriptionResponse, String> {
    let state = context.native_state().await?;
    let connection = get_connection(&state, &connection_id).await?;
    let subscription_id = cancel_key.unwrap_or_else(|| next_native_id("subscription"));
    let Some(mut stopped) = state.stream_stops.lock().await.register(&subscription_id) else {
        return Err("subscription cancelled".to_owned());
    };
    let opened = async {
        let (mut send, receive) = connection
            .open_bi()
            .await
            .map_err(|error| error.to_string())?;
        write_frame(&mut send, json.as_bytes()).await?;
        send.finish().map_err(|error| error.to_string())?;
        Ok::<_, String>(receive)
    };
    let opened = tokio::select! {
        result = opened => result,
        _ = &mut stopped => Err("subscription cancelled".to_owned()),
    };
    let mut receive = match opened {
        Ok(receive) => receive,
        Err(error) => {
            state.stream_stops.lock().await.remove(&subscription_id);
            return Err(error);
        }
    };

    let app_for_stream = app.clone();
    let connection_for_stream = connection.clone();
    let stream_connection_id = connection_id.clone();
    let stream_subscription_id = subscription_id.clone();
    let stops = state.stream_stops.clone();
    tauri::async_runtime::spawn(async move {
        let reason = loop {
            let frame = tokio::select! {
                result = read_frame(&mut receive) => result,
                _ = &mut stopped => {
                    let _ = receive.stop(0_u32.into());
                    break None;
                }
            };
            match frame {
                Ok(Some(json)) => {
                    if app_for_stream
                        .emit(
                            "native://stream",
                            StreamEvent {
                                connection_id: stream_connection_id.clone(),
                                subscription_id: stream_subscription_id.clone(),
                                json,
                            },
                        )
                        .is_err()
                    {
                        break Some("could not deliver a stream event".to_owned());
                    }
                }
                Ok(None) => break None,
                Err(error) => {
                    if matches!(&error, FrameReadError::TooLarge) {
                        connection_for_stream.close(0_u32.into(), b"frame exceeds 4 MiB limit");
                    }
                    break Some(error.to_string());
                }
            }
        };
        stops.lock().await.remove(&stream_subscription_id);
        let _ = app_for_stream.emit(
            "native://subscription-ended",
            SubscriptionEndedEvent {
                connection_id: stream_connection_id,
                subscription_id: stream_subscription_id,
                reason,
            },
        );
    });

    Ok(SubscriptionResponse { subscription_id })
}

#[tauri::command]
pub(crate) async fn native_cancel_stream(
    stream_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    state.stream_stops.lock().await.cancel(&stream_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_disconnect(
    connection_id: String,
    context: State<'_, Arc<NativeContext>>,
) -> Result<(), String> {
    let state = context.native_state().await?;
    let connection = {
        let mut connections = state.connections.lock().await;
        let Some(entry) = connections.by_id.remove(&connection_id) else {
            return Ok(());
        };
        if connections.by_host.get(&entry.host_key) == Some(&connection_id) {
            connections.by_host.remove(&entry.host_key);
        }
        entry.connection
    };
    connection.close(0_u32.into(), b"client disconnected");
    Ok(())
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

pub(crate) async fn get_connection(
    state: &NativeState,
    connection_id: &str,
) -> Result<Connection, String> {
    state
        .connections
        .lock()
        .await
        .by_id
        .get(connection_id)
        .map(|entry| entry.connection.clone())
        .ok_or_else(|| "connection is not available".to_owned())
}

pub(crate) async fn write_frame(
    send: &mut iroh::endpoint::SendStream,
    bytes: &[u8],
) -> Result<(), String> {
    let frame = encode_frame(bytes)?;
    send.write_all(&frame)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) async fn read_frame(
    receive: &mut iroh::endpoint::RecvStream,
) -> Result<Option<String>, FrameReadError> {
    let mut length = [0_u8; 4];
    match receive.read_exact(&mut length).await {
        Ok(()) => {}
        Err(iroh::endpoint::ReadExactError::FinishedEarly(0)) => return Ok(None),
        Err(error) => return Err(FrameReadError::Other(error.to_string())),
    }
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(FrameReadError::TooLarge);
    }
    let mut bytes = vec![0_u8; length];
    receive
        .read_exact(&mut bytes)
        .await
        .map_err(|error| FrameReadError::Other(error.to_string()))?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| FrameReadError::Other(error.to_string()))
}

fn resolve_addresses(addresses: &[String], allow_relay: bool) -> Result<Vec<SocketAddr>, String> {
    let mut resolved = Vec::new();
    let mut seen = HashSet::new();
    let mut resolution_error = None;
    for address in addresses {
        match address.to_socket_addrs() {
            Ok(entries) => {
                for entry in entries {
                    if seen.insert(entry) {
                        resolved.push(entry);
                    }
                }
            }
            Err(error) => resolution_error = Some(error),
        }
    }
    if resolved.is_empty() && !allow_relay {
        return Err(resolution_error.map_or_else(
            || "no Host addresses were provided".to_owned(),
            |error| format!("could not resolve Host address: {error}"),
        ));
    }
    Ok(resolved)
}

fn parse_public_key(public_key: &str) -> Result<EndpointId, String> {
    let bytes = decode_hex(public_key)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Host public key must be 32 bytes".to_owned())?;
    EndpointId::from_bytes(&bytes).map_err(|error| error.to_string())
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

fn encode_frame(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(format!("frame exceeds the {MAX_FRAME_BYTES}-byte limit"));
    }
    let length = u32::try_from(bytes.len()).map_err(|error| error.to_string())?;
    let mut frame = Vec::with_capacity(4 + bytes.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(bytes);
    Ok(frame)
}

fn next_native_id(kind: &str) -> String {
    format!("{kind}-{}", NEXT_NATIVE_ID.fetch_add(1, Ordering::Relaxed))
}

fn connection_close_reason(reason: iroh::endpoint::ConnectionError) -> String {
    match reason {
        iroh::endpoint::ConnectionError::ApplicationClosed(close) => {
            String::from_utf8_lossy(&close.reason).into_owned()
        }
        reason => reason.to_string(),
    }
}

fn open_database(app_data_dir: &Path) -> Result<SqliteConnection, String> {
    std::fs::create_dir_all(app_data_dir).map_err(|error| error.to_string())?;
    let database = SqliteConnection::open(app_data_dir.join(DATABASE_FILE))
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            app_data_dir.join(DATABASE_FILE),
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(|error| error.to_string())?;
    }
    database
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS hosts (\
               public_key TEXT PRIMARY KEY NOT NULL,\
               host_name TEXT NOT NULL,\
               addresses_json TEXT NOT NULL\
             );\
             CREATE TABLE IF NOT EXISTS host_setup (\
               public_key TEXT PRIMARY KEY NOT NULL,\
               destination TEXT NOT NULL\
             );\
             CREATE TABLE IF NOT EXISTS active_host (\
               singleton INTEGER PRIMARY KEY,\
               public_key TEXT NOT NULL\
             );\
             CREATE TABLE IF NOT EXISTS client_views (\
               scope TEXT PRIMARY KEY NOT NULL,\
               ciphertext BLOB NOT NULL\
             );",
        )
        .map_err(|error| error.to_string())?;
    Ok(database)
}

#[cfg(target_os = "windows")]
fn load_or_create_windows_identity(path: &Path) -> Result<SecretKey, String> {
    use std::{
        fs::OpenOptions,
        io::{Read, Write},
    };

    match std::fs::File::open(path) {
        Ok(mut file) => {
            let mut ciphertext = Vec::new();
            file.read_to_end(&mut ciphertext)
                .map_err(|error| error.to_string())?;
            let plaintext = Zeroizing::new(dpapi_unprotect(&ciphertext)?);
            let bytes: [u8; 32] = plaintext
                .as_slice()
                .try_into()
                .map_err(|_| "DPAPI identity must contain exactly 32 bytes".to_owned())?;
            Ok(SecretKey::from_bytes(&bytes))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let secret_key = SecretKey::generate();
            let secret = Zeroizing::new(secret_key.to_bytes());
            let ciphertext = dpapi_protect(secret.as_ref())?;
            let temporary_path = identity_temporary_path(path);
            let write_result = (|| {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary_path)?;
                file.write_all(&ciphertext)?;
                file.sync_all()?;
                drop(file);
                match std::fs::rename(&temporary_path, path) {
                    Ok(()) => Ok(()),
                    Err(error) if path.exists() => Err(std::io::Error::new(
                        std::io::ErrorKind::AlreadyExists,
                        error,
                    )),
                    Err(error) => Err(error),
                }
            })();
            match write_result {
                Ok(()) => Ok(secret_key),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let _ = std::fs::remove_file(&temporary_path);
                    drop(secret_key);
                    load_or_create_windows_identity(path)
                }
                Err(error) => {
                    let _ = std::fs::remove_file(&temporary_path);
                    Err(error.to_string())
                }
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "windows")]
fn identity_temporary_path(path: &Path) -> PathBuf {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        NEXT_NATIVE_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(target_os = "windows")]
fn dpapi_protect(secret: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData,
    };

    let length = u32::try_from(secret.len()).map_err(|error| error.to_string())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: secret.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let ciphertext =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output.pbData.cast());
    }
    Ok(ciphertext)
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
    };

    let length = u32::try_from(ciphertext.len()).map_err(|error| error.to_string())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: ciphertext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let plaintext =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        windows_sys::Win32::Foundation::LocalFree(output.pbData.cast());
    }
    Ok(plaintext)
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

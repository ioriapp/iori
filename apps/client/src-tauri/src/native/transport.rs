use super::{NEXT_NATIVE_ID, NativeState, RelaySettings, decode_hex};
use futures_lite::Stream;
use iori_iroh_config::{ALPN, endpoint_builder};
use iroh::{Endpoint, EndpointAddr, EndpointId, endpoint::Connection};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    net::{SocketAddr, ToSocketAddrs},
    sync::{Arc, atomic::Ordering},
};
use tauri::{AppHandle, Emitter, Wry};

pub(crate) const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

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

// Ordered by receipt of a changed Host setting. A relay accepts one active
// connection per endpoint identity, so every Host uses the same Client endpoint.
#[derive(Default)]
pub(super) struct RelayEndpoint {
    endpoint: Option<Endpoint>,
    pub(super) hosts: Vec<(String, RelaySettings)>,
    applied: Vec<RelaySettings>,
}

impl RelayEndpoint {
    fn configuration(
        &self,
        host_key: &str,
        relay: Option<&RelaySettings>,
        local_hosts: &[String],
    ) -> Vec<RelaySettings> {
        let previous = self
            .hosts
            .iter()
            .find(|(key, _)| key == host_key)
            .map(|(_, settings)| settings);
        let changed = previous != relay;
        let mut relays = std::collections::BTreeMap::new();
        for (key, settings) in &self.hosts {
            if (!changed || key != host_key) && !local_hosts.contains(key) {
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
pub(super) struct ConnectionTable {
    by_id: HashMap<String, ConnectionEntry>,
    by_host: HashMap<String, String>,
}

// Cancels for keys not registered yet; the WebView may cancel before the request reaches Rust.
const EARLY_CANCELS: usize = 64;

/// Stop handles of cancellable streams, keyed by the WebView's cancel key.
#[derive(Default)]
pub(super) struct StreamStops {
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

    async fn endpoint(
        &self,
        host_key: &str,
        relay: Option<RelaySettings>,
    ) -> Result<Endpoint, String> {
        let mut current = self.endpoint.lock().await;
        let local_hosts = self
            .database
            .hosts()?
            .into_iter()
            .filter(|host| host.connection_scope.as_deref() == Some("loopback"))
            .map(|host| host.public_key)
            .collect::<Vec<_>>();
        let settings = current.configuration(host_key, relay.as_ref(), &local_hosts);
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

pub(super) async fn connect(
    public_key: String,
    addresses: Vec<String>,
    relay: Option<RelaySettings>,
    app: AppHandle<Wry>,
    state: Arc<NativeState>,
) -> Result<ConnectionResponse, String> {
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

pub(super) async fn request(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    state: Arc<NativeState>,
) -> Result<String, String> {
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

pub(super) async fn subscribe(
    connection_id: String,
    json: String,
    cancel_key: Option<String>,
    app: AppHandle<Wry>,
    state: Arc<NativeState>,
) -> Result<SubscriptionResponse, String> {
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

pub(super) async fn cancel_stream(
    stream_id: String,
    state: Arc<NativeState>,
) -> Result<(), String> {
    state.stream_stops.lock().await.cancel(&stream_id);
    Ok(())
}

pub(super) async fn disconnect(
    connection_id: String,
    state: Arc<NativeState>,
) -> Result<(), String> {
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

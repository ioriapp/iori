use std::{
    net::SocketAddr,
    str::FromStr,
    sync::{Arc, Once, Weak},
};

use iori_iroh_config::{ALPN, endpoint_builder};
use iroh::{
    EndpointAddr, SecretKey,
    endpoint::{Endpoint as IrohEndpoint, Incoming as IrohIncoming},
};
use napi::{Error, Status, bindgen_prelude::Buffer};
use napi_derive::napi;
use tokio::sync::{Mutex, watch};
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

fn initialize_tracing() {
    static INITIALIZE: Once = Once::new();
    INITIALIZE.call_once(|| {
        let filter = EnvFilter::builder()
            .with_default_directive(LevelFilter::WARN.into())
            .from_env_lossy();
        // try_init leaves an existing subscriber alone. stderr write failures
        // are ignored by fmt; they must not bring down a headless Host.
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .without_time()
            .with_ansi(false)
            .with_writer(std::io::stderr)
            .log_internal_errors(false)
            .try_init();
    });
}

#[napi(object)]
pub struct Identity {
    pub secret_key: Buffer,
    pub endpoint_id: String,
    pub public_key_hex: String,
}

#[napi(catch_unwind)]
pub fn generate_identity() -> Identity {
    identity_from_key(SecretKey::generate())
}

#[napi(catch_unwind)]
pub fn identity_from_secret_key(secret_key: Buffer) -> napi::Result<Identity> {
    let secret_key = parse_secret_key(&secret_key)?;
    Ok(identity_from_key(secret_key))
}

#[napi(catch_unwind)]
pub fn protect_user_data(data: Buffer) -> napi::Result<Buffer> {
    #[cfg(windows)]
    {
        return protect_with_dpapi(data.as_ref()).map(Into::into);
    }

    #[cfg(not(windows))]
    {
        Ok(data)
    }
}

#[napi(catch_unwind)]
pub fn unprotect_user_data(data: Buffer) -> napi::Result<Buffer> {
    #[cfg(windows)]
    {
        return unprotect_with_dpapi(data.as_ref()).map(Into::into);
    }

    #[cfg(not(windows))]
    {
        Ok(data)
    }
}

fn identity_from_key(secret_key: SecretKey) -> Identity {
    let endpoint_id = secret_key.public();
    Identity {
        secret_key: secret_key.to_bytes().to_vec().into(),
        endpoint_id: endpoint_id.to_string(),
        public_key_hex: encode_hex(endpoint_id.as_bytes()),
    }
}

fn parse_secret_key(bytes: &[u8]) -> napi::Result<SecretKey> {
    let bytes: &[u8; 32] = bytes
        .try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "secret key must contain 32 bytes"))?;
    Ok(SecretKey::from_bytes(bytes))
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn parse_socket_addr(address: &str) -> napi::Result<SocketAddr> {
    SocketAddr::from_str(address).map_err(|error| {
        Error::new(
            Status::InvalidArg,
            format!("invalid socket address: {error}"),
        )
    })
}

#[napi(js_name = "Endpoint")]
pub struct JsEndpoint {
    inner: std::sync::Mutex<Option<IrohEndpoint>>,
    id: iroh::EndpointId,
}

impl JsEndpoint {
    fn endpoint(&self) -> napi::Result<IrohEndpoint> {
        self.inner
            .lock()
            .expect("poisoned endpoint")
            .clone()
            .ok_or_else(|| Error::from_reason("endpoint closed"))
    }
}

#[napi]
impl JsEndpoint {
    #[napi(factory)]
    pub async fn bind(
        secret_key: Buffer,
        bind_addresses: Vec<String>,
        relay_url: Option<String>,
        relay_token: Option<String>,
    ) -> napi::Result<Self> {
        initialize_tracing();
        let secret_key = parse_secret_key(&secret_key)?;
        let bind_addresses = bind_addresses
            .iter()
            .map(|address| parse_socket_addr(address))
            .collect::<napi::Result<Vec<_>>>()?;
        let builder = endpoint_builder(
            secret_key,
            &bind_addresses,
            relay_url
                .as_deref()
                .map(|url| iori_iroh_config::relay_config(url, relay_token.as_deref()))
                .transpose()
                .map_err(Error::from_reason)?
                .into_iter()
                .collect(),
        )
        .map_err(Error::from_reason)?;
        let inner = builder
            .bind()
            .await
            .map_err(|error| Error::from_reason(error.to_string()))?;
        Ok(Self {
            id: inner.id(),
            inner: std::sync::Mutex::new(Some(inner)),
        })
    }

    #[napi(getter, catch_unwind)]
    pub fn endpoint_id(&self) -> String {
        self.id.to_string()
    }

    #[napi(getter, catch_unwind)]
    pub fn public_key_hex(&self) -> String {
        encode_hex(self.id.as_bytes())
    }

    #[napi(getter, catch_unwind)]
    pub fn bound_sockets(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("poisoned endpoint")
            .as_ref()
            .map(IrohEndpoint::bound_sockets)
            .unwrap_or_default()
            .into_iter()
            .map(|address| address.to_string())
            .collect()
    }

    #[napi]
    pub async fn add_external_addr(&self, address: String) -> napi::Result<()> {
        self.endpoint()?
            .add_external_addr(parse_socket_addr(&address)?)
            .await;
        Ok(())
    }

    #[napi]
    pub async fn accept(&self) -> napi::Result<Option<JsIncoming>> {
        let Ok(endpoint) = self.endpoint() else {
            return Ok(None);
        };
        let Some(incoming) = endpoint.accept().await else {
            return Ok(None);
        };
        Ok(Some(JsIncoming {
            inner: Mutex::new(Some(incoming)),
            cancelled: watch::channel(false).0,
        }))
    }

    #[napi]
    pub async fn connect(
        &self,
        peer_public_key: Buffer,
        direct_addresses: Vec<String>,
    ) -> napi::Result<JsConnection> {
        let peer_public_key: &[u8; 32] = peer_public_key
            .as_ref()
            .try_into()
            .map_err(|_| Error::new(Status::InvalidArg, "peer public key must contain 32 bytes"))?;
        let peer_id = iroh::EndpointId::from_bytes(peer_public_key)
            .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))?;
        let mut peer_address = EndpointAddr::from(peer_id);
        for address in &direct_addresses {
            peer_address = peer_address.with_ip_addr(parse_socket_addr(address)?);
        }
        let connection = self
            .endpoint()?
            .connect(peer_address, ALPN)
            .await
            .map_err(|error| Error::from_reason(error.to_string()))?;
        Ok(JsConnection::new(connection))
    }

    #[napi]
    pub async fn close(&self) {
        // Connection shutdown releases its native resources independently of
        // when V8 collects the JavaScript wrappers.
        let endpoint = self.inner.lock().expect("poisoned endpoint").take();
        if let Some(endpoint) = endpoint {
            endpoint.close().await;
        }
    }
}

#[napi(js_name = "Incoming")]
pub struct JsIncoming {
    inner: Mutex<Option<IrohIncoming>>,
    cancelled: watch::Sender<bool>,
}

#[napi]
impl JsIncoming {
    #[napi]
    pub async fn handshake(&self) -> napi::Result<JsConnection> {
        let incoming = self
            .inner
            .lock()
            .await
            .take()
            .ok_or_else(|| Error::from_reason("incoming handshake already started"))?;
        let mut cancelled = self.cancelled.subscribe();
        if *cancelled.borrow() {
            incoming.refuse();
            return Err(Error::from_reason("incoming handshake retired"));
        }
        // Dropping iroh's IncomingFuture drops its noq Connecting reference,
        // which closes the in-progress QUIC connection without a time limit.
        let connection = tokio::select! {
            biased;
            _ = cancelled.changed() => {
                return Err(Error::from_reason("incoming handshake retired"));
            }
            result = async { incoming.await } => result.map_err(|error| Error::from_reason(error.to_string()))?,
        };
        Ok(JsConnection::new(connection))
    }

    #[napi]
    pub async fn refuse(&self) -> napi::Result<()> {
        self.cancelled.send_replace(true);
        if let Some(incoming) = self.inner.lock().await.take() {
            incoming.refuse();
        }
        Ok(())
    }
}

struct ConnectionResources {
    connection: std::sync::Mutex<Option<iroh::endpoint::Connection>>,
    streams: std::sync::Mutex<Vec<Weak<StreamResources>>>,
    closed: watch::Sender<Option<String>>,
}

impl ConnectionResources {
    fn connection(&self) -> napi::Result<iroh::endpoint::Connection> {
        self.connection
            .lock()
            .expect("poisoned connection")
            .clone()
            .ok_or_else(|| Error::from_reason("connection closed"))
    }

    fn stream(
        &self,
        send: iroh::endpoint::SendStream,
        recv: iroh::endpoint::RecvStream,
    ) -> napi::Result<JsBiStream> {
        let connection = self.connection.lock().expect("poisoned connection");
        if connection.is_none() {
            return Err(Error::from_reason("connection closed"));
        }
        let stream = JsBiStream::new(send, recv);
        let mut streams = self.streams.lock().expect("poisoned streams");
        streams.retain(|stream| stream.strong_count() > 0);
        streams.push(Arc::downgrade(&stream.inner));
        Ok(stream)
    }

    async fn release(&self, reason: String) {
        let streams = {
            // Pair this lock with stream registration, so a stream returned
            // during shutdown is either included here or immediately dropped.
            let mut connection = self.connection.lock().expect("poisoned connection");
            connection.take();
            std::mem::take(&mut *self.streams.lock().expect("poisoned streams"))
        };
        for stream in streams.into_iter().filter_map(|stream| stream.upgrade()) {
            stream.send_interrupted.send_replace(true);
            stream.recv_interrupted.send_replace(true);
            stream.send.lock().await.take();
            stream.recv.lock().await.take();
        }
        self.closed.send_replace(Some(reason));
    }
}

#[napi(js_name = "Connection")]
pub struct JsConnection {
    inner: Arc<ConnectionResources>,
    remote_id: iroh::EndpointId,
}

impl JsConnection {
    fn new(connection: iroh::endpoint::Connection) -> Self {
        let remote_id = connection.remote_id();
        let watcher = connection.clone();
        let (closed, _) = watch::channel(None);
        let inner = Arc::new(ConnectionResources {
            connection: std::sync::Mutex::new(Some(connection)),
            streams: std::sync::Mutex::new(Vec::new()),
            closed,
        });
        let resources = inner.clone();
        tokio::spawn(async move {
            let reason = watcher.closed().await.to_string();
            drop(watcher);
            resources.release(reason).await;
        });
        Self { inner, remote_id }
    }
}

#[napi]
impl JsConnection {
    #[napi(getter, catch_unwind)]
    pub fn remote_endpoint_id(&self) -> String {
        self.remote_id.to_string()
    }

    #[napi(getter, catch_unwind)]
    pub fn remote_public_key_hex(&self) -> String {
        encode_hex(self.remote_id.as_bytes())
    }

    #[napi(catch_unwind)]
    pub fn paths(&self) -> napi::Result<Vec<PathSnapshot>> {
        Ok(self
            .inner
            .connection()?
            .paths()
            .iter()
            .map(|path| PathSnapshot {
                is_selected: path.is_selected(),
                is_ip: path.is_ip(),
                is_relay: path.is_relay(),
                remote_addr: path.remote_addr().to_string(),
            })
            .collect())
    }

    #[napi]
    pub async fn open_bi(&self) -> napi::Result<JsBiStream> {
        let (send, recv) = self
            .inner
            .connection()?
            .open_bi()
            .await
            .map_err(|error| Error::from_reason(error.to_string()))?;
        self.inner.stream(send, recv)
    }

    #[napi]
    pub async fn accept_bi(&self) -> napi::Result<JsBiStream> {
        let (send, recv) = self
            .inner
            .connection()?
            .accept_bi()
            .await
            .map_err(|error| Error::from_reason(error.to_string()))?;
        self.inner.stream(send, recv)
    }

    #[napi(catch_unwind)]
    pub fn close(&self, error_code: u32, reason: Buffer) {
        if let Ok(connection) = self.inner.connection() {
            connection.close(error_code.into(), reason.as_ref());
        }
    }

    #[napi]
    pub async fn closed(&self) -> String {
        let mut closed = self.inner.closed.subscribe();
        loop {
            if let Some(reason) = closed.borrow().clone() {
                return reason;
            }
            if closed.changed().await.is_err() {
                return "connection closed".to_owned();
            }
        }
    }
}

#[napi(object)]
pub struct PathSnapshot {
    pub is_selected: bool,
    pub is_ip: bool,
    pub is_relay: bool,
    pub remote_addr: String,
}

pub struct StreamResources {
    send: Mutex<Option<iroh::endpoint::SendStream>>,
    recv: Mutex<Option<iroh::endpoint::RecvStream>>,
    send_interrupted: watch::Sender<bool>,
    recv_interrupted: watch::Sender<bool>,
}

#[napi(js_name = "BiStream")]
pub struct JsBiStream {
    inner: Arc<StreamResources>,
}

impl std::ops::Deref for JsBiStream {
    type Target = StreamResources;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl JsBiStream {
    fn new(send: iroh::endpoint::SendStream, recv: iroh::endpoint::RecvStream) -> Self {
        let (send_interrupted, _) = watch::channel(false);
        let (recv_interrupted, _) = watch::channel(false);
        Self {
            inner: Arc::new(StreamResources {
                send: Mutex::new(Some(send)),
                recv: Mutex::new(Some(recv)),
                send_interrupted,
                recv_interrupted,
            }),
        }
    }
}

#[cfg(windows)]
fn protect_with_dpapi(data: &[u8]) -> napi::Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData};

    transform_with_dpapi(data, |input, output| {
        // SAFETY: `input` and `output` are valid blobs for the duration of this call.
        unsafe {
            CryptProtectData(
                input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                output,
            )
        }
    })
    .map(|output| {
        // SAFETY: DPAPI allocates output with LocalAlloc, so LocalFree releases it.
        unsafe { LocalFree(output.pb_data.cast()) };
        output.bytes
    })
}

#[cfg(windows)]
fn unprotect_with_dpapi(data: &[u8]) -> napi::Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
    };

    transform_with_dpapi(data, |input, output| {
        // SAFETY: `input` and `output` are valid blobs for the duration of this call.
        unsafe {
            CryptUnprotectData(
                input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                output,
            )
        }
    })
    .map(|output| {
        // SAFETY: DPAPI allocates output with LocalAlloc, so LocalFree releases it.
        unsafe { LocalFree(output.pb_data.cast()) };
        output.bytes
    })
}

#[cfg(windows)]
struct DpapiOutput {
    pb_data: *mut u8,
    bytes: Vec<u8>,
}

#[cfg(windows)]
fn transform_with_dpapi(
    data: &[u8],
    transform: impl FnOnce(
        *const windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
        *mut windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
    ) -> windows_sys::core::BOOL,
) -> napi::Result<DpapiOutput> {
    use windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB;

    let input_length =
        u32::try_from(data.len()).map_err(|_| Error::from_reason("protected data is too large"))?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_length,
        pbData: data.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: DPAPI reads the input slice during the call and writes an owned output blob.
    let succeeded = transform(&input, &mut output);
    if succeeded == 0 {
        return Err(Error::from_reason("Windows data protection failed"));
    }
    let bytes = if output.cbData == 0 {
        Vec::new()
    } else {
        if output.pbData.is_null() {
            return Err(Error::from_reason(
                "Windows data protection returned no data",
            ));
        }
        // SAFETY: DPAPI returned `cbData` bytes at `pbData` on success.
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() }
    };
    Ok(DpapiOutput {
        pb_data: output.pbData,
        bytes,
    })
}

async fn lock_unless_interrupted<'a, T>(
    mutex: &'a Mutex<T>,
    interrupted: &mut watch::Receiver<bool>,
    reason: &'static str,
) -> napi::Result<tokio::sync::MutexGuard<'a, T>> {
    if *interrupted.borrow() {
        return Err(Error::from_reason(reason));
    }

    tokio::select! {
        biased;
        _ = interrupted.changed() => Err(Error::from_reason(reason)),
        guard = mutex.lock() => {
            if *interrupted.borrow() {
                Err(Error::from_reason(reason))
            } else {
                Ok(guard)
            }
        }
    }
}

#[napi]
impl JsBiStream {
    #[napi]
    pub async fn read(&self, max_length: u32) -> napi::Result<Option<Buffer>> {
        if max_length == 0 {
            return Err(Error::new(
                Status::InvalidArg,
                "max length must be greater than zero",
            ));
        }
        let mut interrupted = self.recv_interrupted.subscribe();
        let mut recv =
            lock_unless_interrupted(&self.recv, &mut interrupted, "stream receive was stopped")
                .await?;
        let recv = recv
            .as_mut()
            .ok_or_else(|| Error::from_reason("stream closed"))?;
        tokio::select! {
            biased;
            _ = interrupted.changed() => Err(Error::from_reason("stream receive was stopped")),
            result = recv.read_chunk(max_length as usize) => result
                .map(|chunk| chunk.map(|bytes| bytes.to_vec().into()))
                .map_err(|error| Error::from_reason(error.to_string()))
        }
    }

    #[napi]
    pub async fn write(&self, bytes: Buffer) -> napi::Result<()> {
        let mut interrupted = self.send_interrupted.subscribe();
        let mut send =
            lock_unless_interrupted(&self.send, &mut interrupted, "stream send was reset").await?;
        let send = send
            .as_mut()
            .ok_or_else(|| Error::from_reason("stream closed"))?;
        tokio::select! {
            biased;
            _ = interrupted.changed() => Err(Error::from_reason("stream send was reset")),
            result = send.write_all(bytes.as_ref()) => {
                result.map_err(|error| Error::from_reason(error.to_string()))
            }
        }
    }

    #[napi]
    pub async fn finish(&self) -> napi::Result<()> {
        let mut interrupted = self.send_interrupted.subscribe();
        let mut send =
            lock_unless_interrupted(&self.send, &mut interrupted, "stream send was reset").await?;
        let send = send
            .as_mut()
            .ok_or_else(|| Error::from_reason("stream closed"))?;
        send.finish()
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub async fn reset(&self, error_code: u32) -> napi::Result<()> {
        self.send_interrupted.send_replace(true);
        self.send
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| Error::from_reason("stream closed"))?
            .reset(error_code.into())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub async fn stop(&self, error_code: u32) -> napi::Result<()> {
        self.recv_interrupted.send_replace(true);
        self.recv
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| Error::from_reason("stream closed"))?
            .stop(error_code.into())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub async fn bytes_read(&self) -> napi::Result<f64> {
        self.recv
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| Error::from_reason("stream closed"))?
            .bytes_read()
            .map(|bytes| bytes as f64)
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub async fn stopped(&self) -> napi::Result<()> {
        let stopped = self
            .send
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| Error::from_reason("stream closed"))?
            .stopped();
        stopped
            .await
            .map(|_| ())
            .map_err(|error| Error::from_reason(error.to_string()))
    }
}

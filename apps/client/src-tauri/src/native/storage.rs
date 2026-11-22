#[cfg(target_os = "windows")]
use super::NEXT_NATIVE_ID;
#[cfg(target_os = "linux")]
use super::linux_storage;
use super::{HostMetadata, NativeContext, NativeState, PlatformIdentity};
#[cfg(target_os = "android")]
use super::{decode_hex, encode_hex};
#[cfg(any(target_os = "windows", target_os = "android"))]
use iroh::SecretKey;
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::{
    path::Path,
    sync::{Arc, Mutex, atomic::Ordering},
};
use tauri::Manager;
#[cfg(any(target_os = "android", target_os = "windows"))]
use zeroize::Zeroizing;

struct Ciphertext(Vec<u8>);

pub(super) struct ClientDatabase {
    connection: Mutex<SqliteConnection>,
}

pub(super) const DATABASE_FILE: &str = "registrations.sqlite3";
#[cfg(target_os = "windows")]
const WINDOWS_KEY_READ_ERROR: &str = "Cannot read iori's key on this device.";

impl ClientDatabase {
    pub(super) fn hosts(&self) -> Result<Vec<HostMetadata>, String> {
        let database = self
            .connection
            .lock()
            .map_err(|_| "registration database is unavailable".to_owned())?;
        let mut statement = database
            .prepare("SELECT hosts.public_key, host_name, addresses_json, host_setup.destination, host_network.scope FROM hosts LEFT JOIN host_setup ON host_setup.public_key = hosts.public_key LEFT JOIN host_network ON host_network.public_key = hosts.public_key ORDER BY hosts.rowid")
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
                Ok(HostMetadata {
                    connection_scope: row.get(4)?,
                    public_key: row.get(0)?,
                    host_name: row.get(1)?,
                    ssh_destination: row.get(3)?,
                    addresses,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect()
    }

    pub(super) fn active_host_key(&self) -> Result<Option<String>, String> {
        self.connection
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

    pub(super) fn save_host(&self, host: &HostMetadata, select: bool) -> Result<(), String> {
        let addresses_json =
            serde_json::to_string(&host.addresses).map_err(|error| error.to_string())?;
        let mut database = self
            .connection
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
        transaction.execute("INSERT INTO host_network (public_key, scope) VALUES (?1, ?2) ON CONFLICT(public_key) DO UPDATE SET scope = excluded.scope", params![host.public_key, host.connection_scope]).map_err(|error| error.to_string())?;
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

    fn stored_view(&self, scope: &str) -> Result<Option<Ciphertext>, String> {
        self.connection
            .lock()
            .map_err(|_| "view database is unavailable".to_owned())?
            .query_row(
                "SELECT ciphertext FROM client_views WHERE scope = ?1",
                params![scope],
                |row| row.get(0).map(Ciphertext),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn save_view(&self, scope: &str, ciphertext: &Ciphertext) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|_| "view database is unavailable".to_owned())?
            .execute(
                "INSERT INTO client_views (scope, ciphertext) VALUES (?1, ?2) \
                 ON CONFLICT(scope) DO UPDATE SET ciphertext = excluded.ciphertext",
                params![scope, ciphertext.0],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn open(app_data_dir: &Path) -> Result<Self, String> {
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
             CREATE TABLE IF NOT EXISTS host_network (\
               public_key TEXT PRIMARY KEY NOT NULL,\
               scope TEXT\
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
        Ok(Self {
            connection: Mutex::new(database),
        })
    }
}

impl NativeContext {
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
        let identity = self
            .platform_identity(&app_data_dir)
            .await
            .inspect_err(|error| {
                #[cfg(target_os = "linux")]
                if error == linux_storage::KEYRING_READ_ERROR {
                    self.registration_reset_allowed
                        .store(true, Ordering::SeqCst);
                }
                #[cfg(target_os = "windows")]
                if error == WINDOWS_KEY_READ_ERROR {
                    self.registration_reset_allowed
                        .store(true, Ordering::SeqCst);
                }
            })?;
        let database = ClientDatabase::open(&app_data_dir)?;
        let state = Arc::new(NativeState::new(identity, database));
        if let Ok(Some(ciphertext)) = state.database.stored_view("host-relays")
            && let Ok(plaintext) = self.unprotect_view(&ciphertext).await
            && let Ok(hosts) = serde_json::from_str(&plaintext)
        {
            state.endpoint.lock().await.hosts = hosts;
        }
        self.registration_reset_allowed
            .store(false, Ordering::SeqCst);
        *initialized = Some(state.clone());
        Ok(state)
    }

    pub(super) async fn reset_registration(&self) -> Result<(), String> {
        let initialized = self.initialized.lock().await;
        if initialized.is_some() || !self.registration_reset_allowed.load(Ordering::SeqCst) {
            return Err("Could not reset this device's registration.".into());
        }
        let data = self
            .app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        #[cfg(target_os = "linux")]
        linux_storage::reset(&self.app.config().identifier).await?;
        for name in [
            DATABASE_FILE.to_owned(),
            format!("{DATABASE_FILE}-journal"),
            format!("{DATABASE_FILE}-wal"),
            format!("{DATABASE_FILE}-shm"),
        ] {
            remove_saved_file(&data.join(name))?;
        }
        #[cfg(target_os = "windows")]
        remove_saved_file(&data.join("client-key.dpapi"))?;
        #[cfg(target_os = "linux")]
        {
            *self.storage_key.lock().await = None;
        }
        Ok(())
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

    async fn protect_view(&self, plaintext: &str) -> Result<Ciphertext, String> {
        #[cfg(target_os = "windows")]
        {
            dpapi_protect(plaintext.as_bytes()).map(Ciphertext)
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
            decode_hex(&response.value).map(Ciphertext)
        }
        #[cfg(target_os = "linux")]
        {
            let key = self.storage_key.lock().await;
            linux_storage::protect(
                key.as_ref().ok_or("Client storage key unavailable")?,
                plaintext,
            )
            .map(Ciphertext)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
        {
            let _ = plaintext;
            Err("Client view storage is supported on Windows and Android".to_owned())
        }
    }

    async fn unprotect_view(&self, ciphertext: &Ciphertext) -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            let plaintext = Zeroizing::new(dpapi_unprotect(&ciphertext.0)?);
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
                    serde_json::json!({ "value": encode_hex(&ciphertext.0) }),
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
                &ciphertext.0,
            )
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
        {
            let _ = ciphertext;
            Err("Client view storage is supported on Windows and Android".to_owned())
        }
    }

    pub(super) async fn load_view(&self, scope: &str) -> Result<Option<serde_json::Value>, String> {
        let state = self.native_state().await?;
        let Some(ciphertext) = state.database.stored_view(scope)? else {
            return Ok(None);
        };
        let plaintext = self.unprotect_view(&ciphertext).await?;
        serde_json::from_str(&plaintext)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    pub(super) async fn save_view(
        &self,
        scope: &str,
        value: serde_json::Value,
    ) -> Result<(), String> {
        let state = self.native_state().await?;
        let plaintext = serde_json::to_string(&value).map_err(|error| error.to_string())?;
        let ciphertext = self.protect_view(&plaintext).await?;
        state.database.save_view(scope, &ciphertext)
    }

    pub(super) async fn save_relays(
        &self,
        database: &ClientDatabase,
        hosts: &[(String, super::RelaySettings)],
    ) -> Result<(), String> {
        let plaintext =
            serde_json::to_string(hosts).map_err(|_| "could not save Relay settings".to_owned())?;
        let ciphertext = self.protect_view(&plaintext).await?;
        database.save_view("host-relays", &ciphertext)
    }
}

fn remove_saved_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
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
            let plaintext = Zeroizing::new(
                dpapi_unprotect(&ciphertext).map_err(|_| WINDOWS_KEY_READ_ERROR.to_owned())?,
            );
            let bytes: [u8; 32] = plaintext
                .as_slice()
                .try_into()
                .map_err(|_| WINDOWS_KEY_READ_ERROR.to_owned())?;
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

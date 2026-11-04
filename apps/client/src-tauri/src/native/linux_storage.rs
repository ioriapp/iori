use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, Generate, KeyInit},
};
use iroh::SecretKey;
use secret_service::{EncryptionType, SecretService};
use std::{collections::HashMap, path::Path};
use zeroize::Zeroizing;

const KEYRING_ERROR: &str = "Cannot store iori's key in the system keyring (Secret Service). Turn on a keyring such as GNOME Keyring or KWallet, then open iori again.";

const KEYRING_CANCELLED: &str = "Unlocking the keyring was cancelled. You can try again.";
const KEYRING_READ_ERROR: &str = "Cannot read iori's key from the system keyring.";

fn keyring_error(error: secret_service::Error) -> String {
    match error {
        secret_service::Error::Prompt => KEYRING_CANCELLED,
        _ => KEYRING_ERROR,
    }
    .into()
}

pub async fn identity(
    identifier: &str,
    data: &Path,
) -> Result<(SecretKey, Zeroizing<[u8; 32]>), String> {
    let service = SecretService::connect(EncryptionType::Dh)
        .await
        .map_err(keyring_error)?;
    let attributes = HashMap::from([("application", identifier), ("purpose", "client-keys")]);
    let found = service
        .search_items(attributes.clone())
        .await
        .map_err(keyring_error)?;
    let items: Vec<_> = found.unlocked.into_iter().chain(found.locked).collect();
    let secret = if let Some(item) = items.first() {
        item.unlock().await.map_err(keyring_error)?;
        Zeroizing::new(item.get_secret().await.map_err(keyring_error)?)
    } else {
        // A missing key with saved data is not a fresh installation.
        if data.join(super::DATABASE_FILE).exists() {
            return Err(KEYRING_READ_ERROR.into());
        }
        let mut bytes = Zeroizing::new(Vec::with_capacity(64));
        bytes.extend_from_slice(&SecretKey::generate().to_bytes());
        bytes.extend_from_slice(&SecretKey::generate().to_bytes());
        let text = Zeroizing::new(super::encode_hex(&bytes));
        let collection = service
            .get_default_collection()
            .await
            .map_err(keyring_error)?;
        collection.unlock().await.map_err(keyring_error)?;
        collection
            .create_item(
                "iori Client",
                attributes,
                text.as_bytes(),
                false,
                "text/plain",
            )
            .await
            .map_err(keyring_error)?;
        Zeroizing::new(text.as_bytes().to_vec())
    };
    // Text also works with KWallet's Secret Service implementation.
    let text = std::str::from_utf8(&secret).map_err(|_| KEYRING_READ_ERROR)?;
    let bytes = Zeroizing::new(super::decode_hex(text).map_err(|_| KEYRING_READ_ERROR)?);
    let bytes: [u8; 64] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| KEYRING_READ_ERROR)?;
    let bytes = Zeroizing::new(bytes);
    let identity: [u8; 32] = bytes[..32].try_into().map_err(|_| KEYRING_READ_ERROR)?;
    let view: [u8; 32] = bytes[32..].try_into().map_err(|_| KEYRING_READ_ERROR)?;
    Ok((SecretKey::from_bytes(&identity), Zeroizing::new(view)))
}

pub fn protect(key: &[u8; 32], plaintext: &str) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::generate();
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut stored = nonce.to_vec();
    stored.extend(ciphertext);
    Ok(stored)
}

pub fn unprotect(key: &[u8; 32], stored: &[u8]) -> Result<String, String> {
    let (nonce, ciphertext) = stored
        .split_at_checked(12)
        .ok_or("Invalid encrypted Client data")?;
    let nonce = Nonce::try_from(nonce).map_err(|error| error.to_string())?;
    let plaintext = Zeroizing::new(
        Aes256Gcm::new(key.into())
            .decrypt(&nonce, ciphertext)
            .map_err(|error| error.to_string())?,
    );
    String::from_utf8(plaintext.to_vec()).map_err(|error| error.to_string())
}

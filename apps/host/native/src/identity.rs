use iroh::SecretKey;
use napi::{Error, Status, bindgen_prelude::Buffer};
use napi_derive::napi;

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

pub(super) fn parse_secret_key(bytes: &[u8]) -> napi::Result<SecretKey> {
    let bytes: &[u8; 32] = bytes
        .try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "secret key must contain 32 bytes"))?;
    Ok(SecretKey::from_bytes(bytes))
}

pub(super) fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
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

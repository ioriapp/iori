#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::{ClipboardImageExt, init};

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum ClipboardContent {
    Text { text: String },
    Image { data: String },
}

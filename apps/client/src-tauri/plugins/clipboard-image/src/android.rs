use crate::ClipboardContent;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

pub struct ClipboardImage<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ClipboardImage<R> {
    pub async fn read_content(&self) -> Result<ClipboardContent, String> {
        self.0
            .run_mobile_plugin_async("readContent", ())
            .await
            .map_err(|error| error.to_string())
    }
}

pub trait ClipboardImageExt<R: Runtime> {
    fn clipboard_image(&self) -> &ClipboardImage<R>;
}

impl<R: Runtime, T: Manager<R>> ClipboardImageExt<R> for T {
    fn clipboard_image(&self) -> &ClipboardImage<R> {
        self.state::<ClipboardImage<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("clipboard-image")
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "io.github.ioriapp.iori.clipboardimage",
                "ClipboardImagePlugin",
            )?;
            app.manage(ClipboardImage(handle));
            Ok(())
        })
        .build()
}

use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::HashMap,
    fs::File,
    io::Write,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "android")]
use {
    std::io::{Seek, SeekFrom},
    tauri_plugin_dialog::FilePath,
    tauri_plugin_fs::{FsExt, OpenOptions},
};

static NEXT_SAVE: AtomicU64 = AtomicU64::new(1);
#[derive(Default)]
pub(crate) struct FileSaves(Mutex<HashMap<String, Saving>>);
struct Saving {
    file: Option<File>,
    temporary: PathBuf,
    created: bool,
    #[cfg(not(target_os = "android"))]
    target: PathBuf,
    #[cfg(target_os = "android")]
    target: FilePath,
    #[cfg(target_os = "android")]
    app: AppHandle,
    #[cfg(target_os = "android")]
    finished: bool,
}
impl Drop for Saving {
    fn drop(&mut self) {
        self.file.take();
        if self.created {
            let _ = std::fs::remove_file(&self.temporary);
        }
        #[cfg(target_os = "android")]
        if !self.finished {
            // ACTION_CREATE_DOCUMENT creates a new document, never an existing
            // file. Delete that document if its download did not finish.
            if let FilePath::Url(uri) = &self.target {
                let _ = self
                    .app
                    .state::<crate::native::NativeContext>()
                    .delete_saved_document(uri.as_str());
            }
        }
    }
}

/// Desktop writes beside the destination and commits with an atomic rename.
/// Android's new document is filled only after all Host ranges have arrived.
#[tauri::command]
pub(crate) async fn native_file_save_begin(
    app: AppHandle,
    name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let id = NEXT_SAVE.fetch_add(1, Ordering::Relaxed).to_string();
        #[cfg(not(target_os = "android"))]
        let target = target.into_path().map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "android"))]
        let folder = target
            .parent()
            .ok_or("Save folder is unavailable")?
            .to_path_buf();
        #[cfg(target_os = "android")]
        let folder = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("file-saves");
        let temporary = folder.join(format!(".iori-save-{}-{id}", std::process::id()));
        let mut save = Saving {
            file: None,
            temporary,
            target,
            created: false,
            #[cfg(target_os = "android")]
            app: app.clone(),
            #[cfg(target_os = "android")]
            finished: false,
        };
        #[cfg(target_os = "android")]
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        save.file = Some(
            std::fs::OpenOptions::new()
                .write(true)
                .read(true)
                .create_new(true)
                .open(&save.temporary)
                .map_err(|e| e.to_string())?,
        );
        save.created = true;
        app.state::<FileSaves>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), save);
        Ok(Some(id))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn native_file_save_write(
    saves: State<'_, FileSaves>,
    id: String,
    data: String,
) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let mut saves = saves.0.lock().map_err(|e| e.to_string())?;
    let save = saves.get_mut(&id).ok_or("Save closed")?;
    save.file
        .as_mut()
        .ok_or("Save closed")?
        .write_all(&bytes)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn native_file_save_finish(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut save = app
            .state::<FileSaves>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
            .ok_or("Save closed")?;
        save.file
            .as_mut()
            .ok_or("Save closed")?
            .sync_all()
            .map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "android"))]
        {
            save.file.take();
            std::fs::rename(&save.temporary, &save.target).map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "android")]
        {
            let mut options = OpenOptions::new();
            options.write(true).truncate(true);
            let mut target = app
                .fs()
                .open(save.target.clone(), options)
                .map_err(|e| e.to_string())?;
            let source = save.file.as_mut().ok_or("Save closed")?;
            source.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            std::io::copy(source, &mut target).map_err(|e| e.to_string())?;
            target.sync_all().map_err(|e| e.to_string())?;
            save.finished = true;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn native_file_save_cancel(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<FileSaves>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

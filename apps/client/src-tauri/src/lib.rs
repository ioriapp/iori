mod file_saves;
mod host_setup;
mod native;
mod notifications;
mod terminal;
mod updates;
#[cfg(windows)]
mod windows_chrome;
#[cfg(windows)]
mod windows_notifications;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(any(windows, target_os = "linux"))]
    if host_setup::ssh::askpass::run() {
        return;
    }
    let builder = tauri::Builder::default();
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.manage(host_setup::ssh::State::default());
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_apk_installer::init())
        .plugin(tauri_plugin_clipboard_image::init());
    // Register first: URL activation forwards to the existing Client process.
    #[cfg(windows)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.len() == 1 {
                windows_notifications::show_window(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(windows_chrome::init());
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            )
            .build(),
    );
    builder
        .plugin(native::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(file_saves::FileSaves::default())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Restore geometry before showing; never restore a hidden tray window.
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(not(debug_assertions))]
                    window.with_webview(|webview| {
                        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                        use windows::core::Interface;

                        // WebView2 browser shortcuts take precedence over terminal input.
                        let result = unsafe {
                            webview.controller().CoreWebView2().and_then(|view| {
                                view.Settings().and_then(|settings| {
                                    settings
                                        .cast::<ICoreWebView2Settings3>()
                                        .and_then(|settings| {
                                            settings.SetAreBrowserAcceleratorKeysEnabled(false)
                                        })
                                })
                            })
                        };
                        if let Err(error) = result {
                            eprintln!("failed to disable WebView2 browser shortcuts: {error}");
                        }
                    })?;
                    window.show()?;
                }
            }
            notifications::setup(app.handle())?;
            #[cfg(any(windows, target_os = "linux", target_os = "android"))]
            updates::setup(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_candidates,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_connect,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_uninstall_result,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_install,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_allow,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_cancel,
            #[cfg(any(windows, target_os = "linux"))]
            host_setup::ssh::native_ssh_answer,
            host_setup::native_host_setup_status,
            host_setup::native_host_uninstall_result,
            host_setup::native_host_setup_install,
            host_setup::native_host_setup_invite,
            host_setup::native_host_firewall,
            host_setup::native_host_firewall_status,
            updates::native_update_options,
            updates::native_update_check,
            updates::native_update_download,
            updates::native_update_install,
            updates::native_update_resume_installation,
            notifications::native_client_options,
            notifications::native_notification_permission,
            notifications::native_notification_request_permission,
            notifications::native_notify,
            notifications::native_take_notifications,
            native::native_background_connection,
            file_saves::native_file_save_begin,
            file_saves::native_file_save_write,
            file_saves::native_file_save_finish,
            file_saves::native_file_save_cancel,
            native::native_initial_state,
            native::native_save_host,
            native::native_load_view,
            native::native_save_view,
            native::native_load_workspace_layout,
            native::native_save_workspace_layout,
            native::native_load_client_preferences,
            native::native_save_client_preferences,
            native::native_connect,
            native::native_request,
            native::native_subscribe,
            native::native_cancel_stream,
            native::native_disconnect,
            native::native_scan_qr,
            terminal::native_terminal_open,
            terminal::native_terminal_write,
            terminal::native_terminal_acknowledge,
            terminal::native_terminal_detach,
            terminal::native_clipboard_read,
            terminal::native_clipboard_content,
            terminal::native_clipboard_write,
            terminal::native_open_url,
            native::native_back_default,
            native::native_show_keyboard
        ])
        .on_window_event(|_window, _event| {
            #[cfg(windows)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                use std::sync::atomic::Ordering;
                use tauri::Manager;
                if !_window
                    .state::<notifications::ClientOptions>()
                    .close_to_exit
                    .load(Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = _window.hide();
                    use tauri::Emitter;
                    let _ = _window.emit(
                        "native://foreground",
                        serde_json::json!({ "foreground": false }),
                    );
                }
            }
            #[cfg(windows)]
            if let tauri::WindowEvent::Focused(true) = _event {
                use tauri::Emitter;
                let _ = _window.emit(
                    "native://foreground",
                    serde_json::json!({ "foreground": true }),
                );
            }
            #[cfg(mobile)]
            {
                use tauri::{Emitter, WindowEvent};

                let foreground = match _event {
                    WindowEvent::Suspended => Some(false),
                    WindowEvent::Resumed => Some(true),
                    _ => None,
                };
                if let Some(foreground) = foreground {
                    let _ = _window.emit(
                        "native://foreground",
                        serde_json::json!({ "foreground": foreground }),
                    );
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run iori client");
}

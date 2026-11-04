use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct PendingNotifications(Mutex<Vec<NotificationTarget>>);

pub(crate) fn enqueue(app: &AppHandle, target: NotificationTarget) {
    app.state::<PendingNotifications>()
        .0
        .lock()
        .unwrap()
        .push(target);
    let _ = app.emit("native://notification-pending", ());
}

#[tauri::command]
pub(crate) fn native_take_notifications(app: AppHandle) -> Vec<NotificationTarget> {
    std::mem::take(&mut *app.state::<PendingNotifications>().0.lock().unwrap())
}

#[derive(Default)]
pub(crate) struct ClientOptions {
    pub close_to_exit: AtomicBool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationTarget {
    pub host_key: String,
    pub terminal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
}
#[derive(Deserialize)]
pub(crate) struct CliNotification {
    pub id: i32,
    pub title: String,
    pub body: String,
    pub target: NotificationTarget,
}

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(ClientOptions::default());
    app.manage(PendingNotifications::default());
    #[cfg(windows)]
    crate::windows_notifications::setup(app)?;
    let handle = app.clone();
    app.notification()
        .on_action(move |action| {
            if action.action_id() != "tap" {
                return;
            }
            let target = action
                .notification()
                .and_then(|n| n.extra().get("target"))
                .and_then(|value| serde_json::from_value::<NotificationTarget>(value.clone()).ok());
            if let Some(target) = target {
                enqueue(&handle, target);
            }
        })
        .map_err(|error| tauri::Error::Anyhow(error.into()))?;
    #[cfg(windows)]
    {
        use tauri::tray::TrayIconBuilder;
        let japanese = sys_locale::get_locale().is_some_and(|locale| locale.starts_with("ja"));
        let menu = tray_menu(
            app,
            if japanese { "開く" } else { "Open" },
            if japanese { "終了" } else { "Exit" },
        )?;
        TrayIconBuilder::with_id("iori")
            .icon(
                app.default_window_icon()
                    .expect("bundled iori icon")
                    .clone(),
            )
            .tooltip("iori")
            .menu(&menu)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => crate::windows_notifications::show_window(app),
                "exit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
    }
    Ok(())
}

#[cfg(windows)]
fn tray_menu(
    app: &AppHandle,
    open: &str,
    exit: &str,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem};
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", open, true, None::<&str>)?,
            &MenuItem::with_id(app, "exit", exit, true, None::<&str>)?,
        ],
    )
}

#[tauri::command]
pub(crate) fn native_client_options(
    app: AppHandle,
    options: State<'_, ClientOptions>,
    close_to_exit: bool,
    open: String,
    exit: String,
) -> Result<(), String> {
    options
        .close_to_exit
        .store(close_to_exit, Ordering::Relaxed);
    #[cfg(windows)]
    if let Some(tray) = app.tray_by_id("iori") {
        tray.set_menu(Some(
            tray_menu(&app, &open, &exit).map_err(|error| error.to_string())?,
        ))
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (app, open, exit);
    Ok(())
}

fn permission_text(permission: tauri::plugin::PermissionState) -> String {
    match permission {
        tauri::plugin::PermissionState::Granted => "granted",
        tauri::plugin::PermissionState::Denied => "denied",
        _ => "prompt",
    }
    .to_owned()
}
#[tauri::command]
pub(crate) fn native_notification_permission(app: AppHandle) -> Result<String, String> {
    app.notification()
        .permission_state()
        .map(permission_text)
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn native_notification_request_permission(
    app: AppHandle,
) -> Result<String, String> {
    // The plugin performs the platform permission request. Do not block its UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        app.notification()
            .request_permission()
            .map(permission_text)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub(crate) fn native_notify(app: AppHandle, notification: CliNotification) -> Result<(), String> {
    #[cfg(windows)]
    return crate::windows_notifications::show(&app, notification)
        .map_err(|error| error.to_string());
    #[cfg(not(windows))]
    {
        if app
            .notification()
            .permission_state()
            .map_err(|error| error.to_string())?
            != tauri::plugin::PermissionState::Granted
        {
            return Ok(());
        }
        let builder = app.notification().builder();
        #[cfg(target_os = "android")]
        let builder = builder.icon("ic_stat_iori");
        builder
            .id(notification.id)
            .title(notification.title)
            .body(notification.body)
            .extra("target", notification.target)
            .show()
            .map_err(|error| error.to_string())
    }
}

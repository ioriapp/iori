//! Windows protocol activation works for both a live toast and notification
//! history, including after the Client exits. No in-process toast callback.
use crate::notifications::{CliNotification, NotificationTarget, enqueue};
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;
use windows::{
    Data::Xml::Dom::XmlDocument,
    UI::Notifications::{ToastNotification, ToastNotificationManager},
    core::HSTRING,
};

fn scheme(app: &AppHandle) -> &str {
    app.config().plugins.0["deep-link"]["desktop"]["schemes"][0]
        .as_str()
        .expect("bundled notification URL scheme")
}

fn receive(app: &AppHandle, urls: Vec<Url>) {
    show_window(app);
    for url in urls {
        if url.scheme() != scheme(app)
            || url.host_str() != Some("cli")
            || !matches!(url.path(), "" | "/")
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            continue;
        }
        let pairs: Vec<_> = url.query_pairs().collect();
        let host: Vec<_> = pairs.iter().filter(|(key, _)| key == "host").collect();
        let terminal: Vec<_> = pairs.iter().filter(|(key, _)| key == "terminal").collect();
        let team: Vec<_> = pairs.iter().filter(|(key, _)| key == "team").collect();
        if host.len() == 1 && terminal.len() == 1 && team.len() <= 1 {
            // Field shapes, registered Host and existing Terminal are checked
            // at the common routing boundary before any screen is opened.
            enqueue(
                app,
                NotificationTarget {
                    host_key: host[0].1.to_string(),
                    terminal_id: terminal[0].1.to_string(),
                    team_id: team.first().map(|pair| pair.1.to_string()),
                },
            );
        }
    }
}

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| receive(&handle, event.urls()));
    if let Some(urls) = app
        .deep_link()
        .get_current()
        .map_err(|error| tauri::Error::Anyhow(error.into()))?
    {
        receive(app, urls);
    }
    Ok(())
}

pub(crate) fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // The single-instance plugin transfers foreground permission from the
        // process Windows starts for protocol activation. Restore and activate
        // on the window's thread, without racing queued visibility changes.
        let _ = app.run_on_main_thread(move || {
            use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
            // Keep Tauri's visibility/minimization state in sync as well.
            let _ = window.show();
            let _ = window.unminimize();
            if let Ok(hwnd) = window.hwnd() {
                // SAFETY: the main WebViewWindow owns this live HWND. This call
                // runs on its UI thread and does not retain the handle.
                unsafe {
                    SetForegroundWindow(hwnd.0);
                }
            }
        });
    }
}

fn xml_text(text: &str) -> String {
    text.chars()
        .filter(|c| matches!(*c, '\t' | '\n' | '\r') || *c >= ' ')
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(crate) fn show(app: &AppHandle, notification: CliNotification) -> windows::core::Result<()> {
    let mut url = Url::parse(&format!("{}://cli", scheme(app))).expect("bundled notification URL");
    url.query_pairs_mut()
        .append_pair("host", &notification.target.host_key)
        .append_pair("terminal", &notification.target.terminal_id);
    if let Some(team) = &notification.target.team_id {
        url.query_pairs_mut().append_pair("team", team);
    }
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(format!(
        "<toast activationType=\"protocol\" launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        xml_text(url.as_str()), xml_text(&notification.title), xml_text(&notification.body)
    )))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    toast.SetTag(&HSTRING::from(&notification.target.terminal_id))?;
    toast.SetGroup(&HSTRING::from(&notification.target.host_key))?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app.config().identifier))?
        .Show(&toast)
}

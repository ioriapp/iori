// Win32 pointer handling adapted from tauri-plugin-window-controls (MIT).
// Copyright (c) 2026 insd47
// https://github.com/insd47/tauri-plugin-window-controls/tree/4cd13462787906ce0b7a381da689475773ebf629
// License: ../../third-party/TAURI-WINDOW-CONTROLS-MIT-LICENSE.txt
//! The WebView draws the themed buttons. A paint-transparent child window
//! supplies only the maximize button's non-client hit test and pointer input.
//! Windows needs HTMAXBUTTON to offer its own Snap Layout menu:
//! https://learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-snap-layout-menu
use std::ptr::null_mut;
use tauri::{Emitter, Manager, Window};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Input::KeyboardAndMouse::{TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent},
        WindowsAndMessaging::*,
    },
};

const CLASS: &[u16] = &[
    105, 111, 114, 105, 45, 109, 97, 120, 105, 109, 105, 122, 101, 0,
];
struct MaximizeInput {
    window: Window,
    hover: bool,
    pressed: bool,
}
impl MaximizeInput {
    fn emit(&self, parent: HWND) {
        let maximized = unsafe { IsZoomed(parent) != 0 };
        let _ = self.window.emit(
            "native://window-chrome",
            serde_json::json!({
                "maximized": maximized,
                "hover": self.hover,
                "pressed": self.pressed,
            }),
        );
    }
}

pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("window-chrome")
        .js_init_script("Object.defineProperty(window, '__IORI_WINDOW_CHROME__', {value: true});")
        .on_window_ready(|window| {
            if let Err(error) = install(&window) {
                eprintln!("Could not install window maximize input: {error}");
            }
        })
        .on_event(|app, event| {
            if let tauri::RunEvent::WindowEvent { label, event, .. } = event
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
                && let Some(window) = app.get_webview_window(label)
                && let Ok(parent) = window.hwnd()
            {
                unsafe { position(parent.0.cast()) };
            }
        })
        .build()
}

fn install(window: &Window) -> tauri::Result<()> {
    let parent = window.hwnd()?.0 as usize;
    let window = window.clone();
    window.clone().run_on_main_thread(move || unsafe {
        // A hidden window still has the initial caption's client rectangle.
        // Recalculate the undecorated frame before window-state measures its
        // borders to restore the saved inner size (Tao's WM_NCCALCSIZE path).
        SetWindowPos(
            parent as HWND,
            null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
        let module = GetModuleHandleW(null_mut());
        let class = WNDCLASSW {
            style: CS_DBLCLKS,
            lpfnWndProc: Some(input_proc),
            hInstance: module,
            lpszClassName: CLASS.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&class);
        // No brush and WS_EX_TRANSPARENT leave all painting to the WebView.
        // Unlike a layered transparent window this still receives hit tests.
        let child = CreateWindowExW(
            WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
            CLASS.as_ptr(),
            CLASS.as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
            0,
            0,
            0,
            0,
            parent as HWND,
            null_mut(),
            module,
            null_mut(),
        );
        if child.is_null() {
            eprintln!(
                "Could not create window maximize input: {}",
                std::io::Error::last_os_error()
            );
            return;
        }
        let state = Box::into_raw(Box::new(MaximizeInput {
            window,
            hover: false,
            pressed: false,
        }));
        SetWindowLongPtrW(child, GWLP_USERDATA, state as isize);
        position(parent as HWND);
    })
}

unsafe fn position(parent: HWND) {
    unsafe {
        let child = FindWindowExW(parent, null_mut(), CLASS.as_ptr(), null_mut());
        if child.is_null() {
            return;
        }
        let mut rect = std::mem::zeroed();
        GetClientRect(parent, &mut rect);
        let dpi = GetDpiForWindow(parent) as f64 / 96.0;
        // Keep in step with the CSS caption buttons (Windows standard 46 × 32 DIP).
        let width = (46.0 * dpi).round() as i32;
        let height = (32.0 * dpi).round() as i32;
        let top = if IsZoomed(parent) != 0 {
            0
        } else {
            GetSystemMetricsForDpi(SM_CYSIZEFRAME, GetDpiForWindow(parent))
                + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, GetDpiForWindow(parent))
        };
        SetWindowPos(
            child,
            HWND_TOP,
            rect.right - 2 * width,
            top,
            width,
            height - top,
            SWP_NOACTIVATE,
        );
        let state = GetWindowLongPtrW(child, GWLP_USERDATA) as *mut MaximizeInput;
        if !state.is_null() {
            (*state).emit(parent);
        }
    }
}

unsafe extern "system" fn input_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut MaximizeInput;
        if ptr.is_null() {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }
        let state = &mut *ptr;
        match msg {
            WM_NCHITTEST => return HTMAXBUTTON as LRESULT,
            WM_ERASEBKGND => return 1,
            WM_NCMOUSEMOVE => {
                if !state.hover {
                    state.hover = true;
                    state.emit(GetParent(hwnd));
                }
                let mut track = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                TrackMouseEvent(&mut track);
                return 0;
            }
            WM_NCMOUSELEAVE => {
                state.hover = false;
                state.pressed = false;
                state.emit(GetParent(hwnd));
                return 0;
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                state.pressed = true;
                state.emit(GetParent(hwnd));
                return 0;
            }
            WM_NCLBUTTONUP => {
                let pressed = state.pressed;
                state.pressed = false;
                state.emit(GetParent(hwnd));
                if pressed {
                    let parent = GetParent(hwnd);
                    let command = if IsZoomed(parent) != 0 {
                        SC_RESTORE
                    } else {
                        SC_MAXIMIZE
                    };
                    PostMessageW(parent, WM_SYSCOMMAND, command as WPARAM, 0);
                }
                return 0;
            }
            WM_NCDESTROY => {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                drop(Box::from_raw(ptr));
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

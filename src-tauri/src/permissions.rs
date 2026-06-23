//! Per-kind defaults for website permission requests (camera, microphone,
//! geolocation, notifications, sensors, clipboard).
//!
//! On Windows we intercept WebView2's `PermissionRequested` on each tab webview:
//! a kind set to Allow / Block is resolved without a prompt; Ask (the default)
//! leaves the engine's own prompt. The frontend pushes the kind→decision map.
//!
//! Defensive throughout: any failure simply falls back to the native prompt —
//! never a panic/crash (we can't grant/deny, so the engine asks as usual).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

/// kind (COREWEBVIEW2_PERMISSION_KIND value) -> decision (0 = ask, 1 = allow, 2 = block).
pub struct Perms(pub Arc<Mutex<HashMap<i32, u8>>>);

impl Perms {
    pub fn new() -> Self {
        Perms(Arc::new(Mutex::new(HashMap::new())))
    }
}

/// Replace the whole kind→decision map (keys are the numeric kind as a string).
#[tauri::command]
pub fn set_permissions(app: tauri::AppHandle, perms: HashMap<String, String>) {
    let arc = app.state::<Perms>().0.clone();
    let mut m = arc.lock().unwrap();
    m.clear();
    for (k, v) in perms {
        if let Ok(kind) = k.parse::<i32>() {
            let d = match v.as_str() {
                "allow" => 1u8,
                "block" => 2u8,
                _ => 0u8,
            };
            m.insert(kind, d);
        }
    }
}

/// Attach the PermissionRequested interceptor to a (tab) webview.
#[cfg(windows)]
pub fn attach(webview: &tauri::Webview, perms: Arc<Mutex<HashMap<i32, u8>>>) {
    let _ = webview.with_webview(move |pw| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            COREWEBVIEW2_PERMISSION_STATE_DENY, ICoreWebView2PermissionRequestedEventArgs,
        };
        use webview2_com::PermissionRequestedEventHandler;

        let core = match pw.controller().CoreWebView2() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mut token: i64 = 0;
        // Setting State to Allow/Deny resolves the request without the engine's
        // prompt; leaving it Default lets the engine prompt as usual (= "ask").
        let handler = PermissionRequestedEventHandler::create(Box::new(
            move |_wv, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                if let Some(args) = args {
                    let mut kind = COREWEBVIEW2_PERMISSION_KIND(0);
                    if args.PermissionKind(&mut kind).is_ok() {
                        let d = perms.lock().ok().and_then(|m| m.get(&kind.0).copied()).unwrap_or(0);
                        if d == 1 {
                            let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                        } else if d == 2 {
                            let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                        }
                    }
                }
                Ok(())
            },
        ));
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn attach(_webview: &tauri::Webview, _perms: Arc<Mutex<HashMap<i32, u8>>>) {}

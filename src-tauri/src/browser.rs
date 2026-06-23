//! A reusable, tabbed in-app browser for Tauri 2.
//!
//! Each tab is its own child webview labelled `browser-tab-<id>`, floated over the
//! frontend's placeholder. Only the active tab is shown; the rest are parked
//! off-screen so their state (scroll position, playing video, form input) is
//! preserved across tab switches. The frontend owns the tab list; this module just
//! creates / shows / hides / navigates / closes webviews by id.
//!
//! Three Tauri-2 pitfalls are handled here — see the README for the full story:
//!
//!  1. Creating a webview from a SYNCHRONOUS command deadlocks the main thread on
//!     Windows (tauri#12032)  →  every command is `async`.
//!  2. A child webview created directly on an EXTERNAL url very often renders blank
//!     (tauri#10011), while a local page (`about:blank`) renders fine  →  we create
//!     the webview on `about:blank` and the frontend navigates it afterwards.
//!  3. A remote page can't call back into the app, so ctrl/middle-click "open in new
//!     tab" is done by navigating to a sentinel url that `on_navigation` cancels and
//!     forwards to the frontend.

use serde::Serialize;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

const PREFIX: &str = "browser-tab-";
/// Host the page navigates to (via the init script) to request a new tab.
const NEWTAB_HOST: &str = "newtab.local";

/// Extra WebView2 command-line flags that silence the engine's background
/// "phone-home" traffic: variations/Safe-Browsing/extension polling
/// (`--disable-background-networking`), component & certificate updates, Google
/// Domain Reliability uploads, hyperlink-audit pings, crash (Breakpad) reports,
/// and the autofill / translate / optimization-hint services. We must re-list
/// wry's own defaults (`msWebOOUI,msPdfOOUI,msSmartScreenProtection`) because
/// supplying custom args replaces them — dropping them would silently turn
/// SmartScreen URL reporting back on. Windows-only; a no-op elsewhere.
const BROWSER_ARGS: &str = "--disable-background-networking --disable-component-update --disable-domain-reliability --disable-sync --no-pings --disable-breakpad --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,OptimizationHints,OptimizationTargetPrediction,Translate,AutofillServerCommunication,InterestFeedContentSuggestions";

fn label_of(id: &str) -> String {
    format!("{PREFIX}{id}")
}

#[derive(Clone, Serialize)]
struct NavPayload {
    id: String,
    url: String,
}

/// Injected at document-start into every tab. Turns ctrl-click / middle-click on a
/// link into a new-tab request (a real page→app channel isn't available for remote
/// pages, so it navigates to a sentinel that `on_navigation` intercepts).
const TAB_JS: &str = r#"
(function () {
  try {
    function newTab(u) {
      try { if (u) window.location.href = 'https://newtab.local/?u=' + encodeURIComponent(u); } catch (e) {}
    }
    function linkOf(t) { return t && t.closest ? t.closest('a[href]') : null; }
    document.addEventListener('click', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var a = linkOf(e.target);
      if (a && a.href) { e.preventDefault(); e.stopPropagation(); newTab(a.href); }
    }, true);
    document.addEventListener('auxclick', function (e) {
      if (e.button !== 1) return;
      var a = linkOf(e.target);
      if (a && a.href) { e.preventDefault(); e.stopPropagation(); newTab(a.href); }
    }, true);
  } catch (e) {}
})();
"#;

fn park(wv: &tauri::Webview) {
    let _ = wv.set_size(LogicalSize::new(0.0, 0.0));
    let _ = wv.set_position(LogicalPosition::new(-20000.0, -20000.0));
}

/// Show tab `id` at the given bounds (creating it on `about:blank` if new) and hide
/// every other tab. Returns `true` if the webview was freshly created, so the
/// frontend knows to navigate it to the tab's url.
#[tauri::command]
pub async fn browser_tab_show(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    let w = width.max(1.0);
    let h = height.max(1.0);
    let label = label_of(&id);

    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) && lbl != label {
            park(&wv);
        }
    }

    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
        return Ok(false);
    }

    let window = app.get_window("main").ok_or_else(|| "main window not found".to_string())?;
    let blank: tauri::Url = "about:blank".parse().unwrap();
    let app2 = app.clone();
    let id2 = id.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(blank))
        .initialization_script(TAB_JS)
        .additional_browser_args(BROWSER_ARGS)
        .on_navigation(move |u| {
            if u.host_str() == Some(NEWTAB_HOST) {
                if let Some((_, val)) = u.query_pairs().find(|(k, _)| k == "u") {
                    let _ = app2.emit("browser-new-tab", val.to_string());
                }
                return false; // cancel — keep the current page
            }
            let _ = app2.emit("browser-nav", NavPayload { id: id2.clone(), url: u.to_string() });
            true
        });
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    // Let the blank page come up before the frontend navigates to the real site.
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    Ok(true)
}

#[tauri::command]
pub async fn browser_tab_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let wv = app.get_webview(&label_of(&id)).ok_or_else(|| "tab not open".to_string())?;
    let parsed: tauri::Url = url.parse().map_err(|_| format!("invalid URL: {url}"))?;
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_tab_close(app: AppHandle, id: String) {
    if let Some(wv) = app.get_webview(&label_of(&id)) {
        let _ = wv.close();
    }
}

#[tauri::command]
pub async fn browser_tab_eval(app: AppHandle, id: String, action: String) {
    if let Some(wv) = app.get_webview(&label_of(&id)) {
        let js = match action.as_str() {
            "back" => "history.back()",
            "forward" => "history.forward()",
            "reload" => "location.reload()",
            _ => return,
        };
        let _ = wv.eval(js);
    }
}

/// Park every tab off-screen (e.g. when the browser UI is not visible) while
/// keeping the webviews — and their state — alive.
#[tauri::command]
pub async fn browser_hide_all(app: AppHandle) {
    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) {
            park(&wv);
        }
    }
}

/// Destroy every tab webview. Call this before hiding the window to the tray: a
/// long-lived child webview on a hidden window can stop the window from re-showing
/// and spams "Failed to unregister class Chrome_WidgetWin_0" (tauri#9798). Tabs are
/// recreated from the persisted list when the window comes back.
pub fn close_all_tabs(app: &AppHandle) {
    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) {
            let _ = wv.close();
        }
    }
}

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

use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;
use tauri::{
    webview::{DownloadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
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

#[derive(Clone, Serialize)]
struct ShortcutPayload {
    id: String,
    cmd: String,
}

/// Injected at document-start into every tab:
///  0. restyle the page's native scrollbars to match the app (custom thumb).
///  1. ctrl/middle-click on a link → open it in a new tab (`?u=`).
///  2. browser shortcuts that the page would otherwise swallow → forward to the
///     app (`?cmd=`) so Ctrl+T/W/L/, work even while the page has focus. (Ctrl+R,
///     F5 and Alt+←/→ are handled natively by the engine in-page.)
///
/// (1) and (2) use the `newtab.local` sentinel-navigation channel that
/// `on_navigation` intercepts, since a real page→app channel isn't available for
/// remote pages.
const TAB_JS: &str = r#"
(function () {
  try {
    var s = document.createElement('style');
    s.textContent = '::-webkit-scrollbar{width:12px;height:12px}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.45);border-radius:8px;border:3px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.7);background-clip:content-box}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}';
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
  try {
    function sig(q) {
      try { window.location.href = 'https://newtab.local/?' + q; } catch (e) {}
    }
    function newTab(u) { if (u) sig('u=' + encodeURIComponent(u)); }
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
    document.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      var k = (e.key || '').toLowerCase();
      var cmd = null;
      if (ctrl && k === 't') cmd = 'newtab';
      else if (ctrl && k === 'w') cmd = 'closetab';
      else if (ctrl && k === 'l') cmd = 'focusurl';
      else if (ctrl && k === ',') cmd = 'settings';
      else if (ctrl && k === 'n' && !e.shiftKey) cmd = 'newwindow';
      if (cmd) { e.preventDefault(); e.stopPropagation(); sig('cmd=' + cmd); }
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
    window: tauri::Window,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    let w = width.max(1.0);
    let h = height.max(1.0);
    let label = label_of(&id);
    let app = window.app_handle();
    let win_label = window.label().to_string();

    // Park this window's other tabs only — never another window's.
    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) && lbl != label && wv.window().label() == win_label {
            park(&wv);
        }
    }

    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
        return Ok(false);
    }

    let blank: tauri::Url = "about:blank".parse().unwrap();
    let app2 = app.clone();
    let id2 = id.clone();
    let target = win_label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(blank))
        .initialization_script(TAB_JS)
        .additional_browser_args(BROWSER_ARGS)
        // Intercept downloads: cancel the engine's immediate native download and
        // route http(s) files into our queue instead (browser-style blob:/data:
        // downloads fall through to the engine).
        .on_download(|webview, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                if matches!(url.scheme(), "http" | "https") {
                    let suggested = destination.file_name().map(|n| n.to_string_lossy().to_string());
                    let _ = crate::downloads::enqueue(webview.app_handle(), url.to_string(), suggested);
                    return false;
                }
            }
            true
        })
        .on_navigation(move |u| {
            // Events go only to this tab's owning window, so a second window
            // doesn't react to the first window's pages.
            if u.host_str() == Some(NEWTAB_HOST) {
                if let Some((_, val)) = u.query_pairs().find(|(k, _)| k == "u") {
                    let _ = app2.emit_to(&target, "browser-new-tab", val.to_string());
                } else if let Some((_, cmd)) = u.query_pairs().find(|(k, _)| k == "cmd") {
                    let cmd = cmd.to_string();
                    // These actions target the host chrome, so move OS keyboard
                    // focus back from the page webview to this window's React webview.
                    if cmd == "newtab" || cmd == "focusurl" || cmd == "settings" {
                        if let Some(w) = app2.get_webview_window(&target) {
                            let _ = w.set_focus();
                        }
                    }
                    let _ = app2.emit_to(&target, "browser-shortcut", ShortcutPayload { id: id2.clone(), cmd });
                }
                return false; // cancel — keep the current page
            }
            let _ = app2.emit_to(&target, "browser-nav", NavPayload { id: id2.clone(), url: u.to_string() });
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

/// Park this window's tabs off-screen (e.g. when the browser UI is not visible)
/// while keeping the webviews — and their state — alive.
#[tauri::command]
pub async fn browser_hide_all(window: tauri::Window) {
    let app = window.app_handle();
    let win_label = window.label();
    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) && wv.window().label() == win_label {
            park(&wv);
        }
    }
}

/// Destroy a window's tab webviews. Call this before hiding the (main) window to
/// the tray, or when a secondary window closes: a long-lived child webview on a
/// hidden window can stop it re-showing and spams "Failed to unregister class
/// Chrome_WidgetWin_0" (tauri#9798). Tabs are recreated from the persisted list
/// when the window comes back.
pub fn close_all_tabs(window: &tauri::Window) {
    let app = window.app_handle();
    let win_label = window.label();
    for (lbl, wv) in app.webviews() {
        if lbl.starts_with(PREFIX) && wv.window().label() == win_label {
            let _ = wv.close();
        }
    }
}

/// Monotonic counter for unique secondary-window labels.
pub struct WindowSeq(pub AtomicUsize);

impl WindowSeq {
    pub fn new() -> Self {
        WindowSeq(AtomicUsize::new(1))
    }
}

/// Open a fresh browser window (its own tabs, independent of this one).
#[tauri::command]
pub fn new_window(app: AppHandle) -> Result<(), String> {
    let n = app.state::<WindowSeq>().0.fetch_add(1, Ordering::SeqCst);
    let label = format!("w{n}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("riyo-browser")
        .inner_size(1200.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .decorations(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

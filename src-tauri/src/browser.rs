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

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

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
    arg: String,
}

#[derive(Clone, Serialize)]
struct TitlePayload {
    id: String,
    title: String,
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
      // Prefer WebView2's web-messaging channel: it reaches the host WITHOUT a
      // navigation, so pages with a beforeunload handler (e.g. YouTube Music while
      // playing) don't pop a "Leave site?" prompt on every status update. Fall
      // back to the sentinel navigation only if it's unavailable.
      try {
        var wv = window.chrome && window.chrome.webview;
        if (wv && wv.postMessage) { wv.postMessage(q); return; }
      } catch (e) {}
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

    // Report the page title to the app so the tab strip can show it. Sent after
    // load and whenever <title> changes (debounced + deduped) over the same
    // sentinel channel; a fresh page falls back to its host name until then.
    var lastTitle = null, titleTimer = null, observedTitleEl = null;
    function reportTitle() {
      try {
        var t = (document.title || '').slice(0, 300);
        if (t === lastTitle) return;
        lastTitle = t;
        sig('cmd=title&q=' + encodeURIComponent(t));
      } catch (e) {}
    }
    function scheduleTitle() { if (titleTimer) clearTimeout(titleTimer); titleTimer = setTimeout(reportTitle, 200); }
    var titleObserver = new MutationObserver(scheduleTitle);
    function watchTitle() {
      try {
        var el = document.querySelector('title');
        if (el && el !== observedTitleEl) {
          observedTitleEl = el;
          titleObserver.disconnect();
          titleObserver.observe(el, { childList: true, characterData: true, subtree: true });
        }
      } catch (e) {}
    }
    document.addEventListener('DOMContentLoaded', function () { watchTitle(); scheduleTitle(); });
    window.addEventListener('load', function () { watchTitle(); scheduleTitle(); });
    window.addEventListener('pageshow', scheduleTitle);
    try {
      // Catch the <title> being added or swapped out (SPAs), then (re)watch it.
      var headObserver = new MutationObserver(function () { watchTitle(); scheduleTitle(); });
      var hroot = document.head || document.documentElement;
      if (hroot) headObserver.observe(hroot, { childList: true, subtree: true });
    } catch (e) {}

    // Custom in-page context menu (replaces the engine's native one). Bubble
    // phase + defaultPrevented check so sites with their own menus keep theirs.
    var ctxMenu = null;
    function ctxClose() {
      if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
      document.removeEventListener('mousedown', ctxOutside, true);
      document.removeEventListener('scroll', ctxClose, true);
      window.removeEventListener('blur', ctxClose);
    }
    function ctxOutside(ev) { if (ctxMenu && !ctxMenu.contains(ev.target)) ctxClose(); }
    function ctxCopy(t) { try { navigator.clipboard.writeText(t); } catch (e) {} }
    function ctxItem(label, fn, disabled) {
      var d = document.createElement('div');
      d.textContent = label;
      d.style.cssText = 'padding:7px 12px;font:13px system-ui,-apple-system,sans-serif;color:' + (disabled ? '#5f5f6a' : '#e4e4e7') + ';cursor:' + (disabled ? 'default' : 'pointer') + ';border-radius:6px;white-space:nowrap';
      if (!disabled) {
        d.onmouseenter = function () { d.style.background = '#2a2a32'; };
        d.onmouseleave = function () { d.style.background = 'transparent'; };
        d.onclick = function () { ctxClose(); try { fn(); } catch (e) {} };
      }
      return d;
    }
    function ctxSep() { var s = document.createElement('div'); s.style.cssText = 'height:1px;margin:4px 6px;background:rgba(255,255,255,.08)'; return s; }
    document.addEventListener('contextmenu', function (e) {
      if (e.defaultPrevented) return;
      e.preventDefault();
      ctxClose();
      var rows = [];
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      var img = e.target.tagName === 'IMG' ? e.target : null;
      var vid = e.target.tagName === 'VIDEO' ? e.target : null;
      var sel = (window.getSelection ? String(window.getSelection()) : '').trim();
      var ed = e.target && (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (a) { rows.push(ctxItem('Open link in new tab', function () { newTab(a.href); })); rows.push(ctxItem('Open link in new window', function () { sig('cmd=newwindowurl&q=' + encodeURIComponent(a.href)); })); rows.push(ctxItem('Copy link address', function () { ctxCopy(a.href); })); rows.push(ctxSep()); }
      if (img) { rows.push(ctxItem('Open image in new tab', function () { newTab(img.src); })); rows.push(ctxItem('Copy image address', function () { ctxCopy(img.src); })); rows.push(ctxSep()); }
      if (vid && document.pictureInPictureEnabled && vid.requestPictureInPicture) {
        rows.push(ctxItem(vid.paused ? 'Play' : 'Pause', function () { try { vid.paused ? vid.play() : vid.pause(); } catch (e) {} }));
        rows.push(ctxItem('Picture-in-Picture', function () { try { vid.requestPictureInPicture(); } catch (e) {} }));
        rows.push(ctxSep());
      }
      if (sel) {
        rows.push(ctxItem('Copy', function () { ctxCopy(sel); }));
        var lbl = sel.length > 24 ? sel.slice(0, 24) + '…' : sel;
        rows.push(ctxItem('Search for "' + lbl + '"', function () { sig('cmd=search&q=' + encodeURIComponent(sel)); }));
        rows.push(ctxSep());
      }
      if (ed) {
        rows.push(ctxItem('Cut', function () { try { document.execCommand('cut'); } catch (e) {} }, !sel));
        rows.push(ctxItem('Copy', function () { try { document.execCommand('copy'); } catch (e) {} }, !sel));
        rows.push(ctxItem('Paste', function () { try { document.execCommand('paste'); } catch (e) { try { navigator.clipboard.readText().then(function (t) { try { document.execCommand('insertText', false, t); } catch (e) {} }); } catch (e) {} } }));
        rows.push(ctxItem('Select all', function () { try { document.execCommand('selectAll'); } catch (e) {} }));
        rows.push(ctxSep());
      }
      rows.push(ctxItem('Back', function () { history.back(); }));
      rows.push(ctxItem('Forward', function () { history.forward(); }));
      rows.push(ctxItem('Reload', function () { location.reload(); }));
      ctxMenu = document.createElement('div');
      ctxMenu.style.cssText = 'position:fixed;z-index:2147483647;min-width:190px;padding:5px;margin:0;background:#1a1a1f;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.5)';
      for (var i = 0; i < rows.length; i++) ctxMenu.appendChild(rows[i]);
      document.documentElement.appendChild(ctxMenu);
      var mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
      var x = Math.min(e.clientX, (window.innerWidth || 800) - mw - 6);
      var y = Math.min(e.clientY, (window.innerHeight || 600) - mh - 6);
      ctxMenu.style.left = Math.max(6, x) + 'px';
      ctxMenu.style.top = Math.max(6, y) + 'px';
      setTimeout(function () {
        document.addEventListener('mousedown', ctxOutside, true);
        document.addEventListener('scroll', ctxClose, true);
        window.addEventListener('blur', ctxClose);
      }, 0);
    }, false);

    // --- media monitor + control (toolbar music player / PiP) ---
    // Reports play/pause/metadata to the app (only on discrete events, never per
    // timeupdate) and exposes window.__riyoMedia(action) for host-driven control.
    function riyoActiveMedia() {
      var list = document.querySelectorAll('video, audio');
      for (var i = 0; i < list.length; i++) { if (!list[i].paused && !list[i].ended) return list[i]; }
      for (var j = 0; j < list.length; j++) { if (list[j].currentTime > 0 && !list[j].ended) return list[j]; }
      return null;
    }
    var riyoSuppress = 0;
    window.__riyoMedia = function (action) {
      try {
        var el = riyoActiveMedia();
        if (action === 'playpause') {
          if (el) {
            // The host already updates its UI optimistically; suppress the push
            // that this play/pause event would trigger so we don't navigate the
            // page right after a control action (which could disrupt playback).
            riyoSuppress = Date.now();
            el.paused ? el.play() : el.pause();
          }
        } else if (action === 'pip') {
          var v = el && el.tagName === 'VIDEO' ? el : document.querySelector('video');
          if (v && document.pictureInPictureEnabled && v.requestPictureInPicture) {
            if (document.pictureInPictureElement) document.exitPictureInPicture(); else v.requestPictureInPicture();
          }
        }
      } catch (e) {}
    };
    var riyoLast = '';
    function riyoPushMedia() {
      if (Date.now() - riyoSuppress < 1000) return;
      try {
        var el = riyoActiveMedia();
        var ms = navigator.mediaSession;
        var meta = ms && ms.metadata;
        var has = !!el;
        var playing = el ? !el.paused && !el.ended : false;
        var title = (meta && meta.title) || document.title || '';
        var artist = (meta && meta.artist) || location.hostname.replace(/^www\./, '');
        var art = '';
        try { var aw = meta && meta.artwork; if (aw && aw.length) art = aw[aw.length - 1].src; } catch (e) {}
        var state = JSON.stringify({ has: has, playing: playing, title: title, artist: artist, art: art });
        if (state === riyoLast) return;
        riyoLast = state;
        sig('cmd=media&q=' + encodeURIComponent(state));
      } catch (e) {}
    }
    var riyoTimer = null;
    function riyoMediaSoon() { if (riyoTimer) clearTimeout(riyoTimer); riyoTimer = setTimeout(riyoPushMedia, 450); }
    document.addEventListener('play', function () { riyoMediaSoon(); setTimeout(riyoPushMedia, 1700); }, true);
    document.addEventListener('pause', riyoMediaSoon, true);
    document.addEventListener('ended', riyoMediaSoon, true);
    document.addEventListener('emptied', riyoMediaSoon, true);
    document.addEventListener('loadedmetadata', riyoMediaSoon, true);
  } catch (e) {}
})();
"#;

fn park(wv: &tauri::Webview) {
    let _ = wv.set_size(LogicalSize::new(0.0, 0.0));
    let _ = wv.set_position(LogicalPosition::new(-20000.0, -20000.0));
}

/// Handle a page→app message — a `key=value&…` query string sent either over the
/// WebView2 web-message channel (preferred) or the sentinel-navigation fallback.
/// Emits the matching event to the tab's owning window.
fn handle_sentinel(app: &AppHandle, target: &str, id: &str, query: &str) {
    let url: tauri::Url = match format!("https://{NEWTAB_HOST}/?{}", query.trim_start_matches('?')).parse()
    {
        Ok(u) => u,
        Err(_) => return,
    };
    if let Some((_, val)) = url.query_pairs().find(|(k, _)| k == "u") {
        let _ = app.emit_to(target, "browser-new-tab", val.to_string());
    } else if let Some((_, cmd)) = url.query_pairs().find(|(k, _)| k == "cmd") {
        let cmd = cmd.to_string();
        let arg = url
            .query_pairs()
            .find(|(k, _)| k == "q")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default();
        if cmd == "title" {
            // Page title for the tab strip — data, not a user action.
            let _ = app.emit_to(target, "browser-title", TitlePayload { id: id.to_string(), title: arg });
        } else {
            // These actions target the host chrome, so move OS keyboard focus back
            // from the page webview to this window's React webview.
            if cmd == "newtab" || cmd == "focusurl" || cmd == "settings" {
                if let Some(w) = app.get_webview_window(target) {
                    let _ = w.set_focus();
                }
            }
            let _ = app.emit_to(target, "browser-shortcut", ShortcutPayload { id: id.to_string(), cmd, arg });
        }
    }
}

/// Attach WebView2's web-message channel to a tab so the injected script can reach
/// the app WITHOUT a navigation (avoids the page's beforeunload "Leave site?"
/// prompt). Defensive — any failure just leaves the sentinel-navigation fallback.
#[cfg(windows)]
fn attach_messages(webview: &tauri::Webview, app: AppHandle, id: String, target: String) {
    let _ = webview.with_webview(move |pw| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs;
        use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
        let core = match pw.controller().CoreWebView2() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mut token: i64 = 0;
        let handler = WebMessageReceivedEventHandler::create(Box::new(
            move |_wv, args: Option<ICoreWebView2WebMessageReceivedEventArgs>| {
                if let Some(args) = args {
                    let mut s = Default::default();
                    if args.TryGetWebMessageAsString(&mut s).is_ok() {
                        handle_sentinel(&app, &target, &id, &take_pwstr(s));
                    }
                }
                Ok(())
            },
        ));
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

#[cfg(not(windows))]
fn attach_messages(_webview: &tauri::Webview, _app: AppHandle, _id: String, _target: String) {}

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
            // Fallback page→app channel: a page that can't reach the web-message
            // channel signals via a sentinel navigation that we cancel here. Events
            // go only to this tab's owning window, so a second window doesn't react
            // to the first window's pages.
            if u.host_str() == Some(NEWTAB_HOST) {
                handle_sentinel(&app2, &target, &id2, u.query().unwrap_or(""));
                return false; // cancel — keep the current page
            }
            let _ = app2.emit_to(&target, "browser-nav", NavPayload { id: id2.clone(), url: u.to_string() });
            true
        });
    let tab = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    // Apply the user's per-kind permission defaults (camera/mic/geolocation/...).
    crate::permissions::attach(&tab, app.state::<crate::permissions::Perms>().0.clone());
    // Wire the navigation-free page→app message channel (see attach_messages).
    attach_messages(&tab, app.clone(), id.clone(), win_label.clone());
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

/// Drive a tab's active media element from the toolbar player (play/pause, PiP).
#[tauri::command]
pub async fn browser_tab_media(app: AppHandle, id: String, action: String) {
    if !matches!(action.as_str(), "playpause" | "pip") {
        return;
    }
    if let Some(wv) = app.get_webview(&label_of(&id)) {
        let _ = wv.eval(&format!("window.__riyoMedia&&window.__riyoMedia('{action}')"));
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

/// URL a freshly-opened window should load into its first tab (keyed by window
/// label). The new window's frontend takes it on startup.
pub struct PendingOpen(pub Mutex<HashMap<String, String>>);

impl PendingOpen {
    pub fn new() -> Self {
        PendingOpen(Mutex::new(HashMap::new()))
    }
}

/// Open a fresh browser window (its own tabs, independent of this one). If `url`
/// is given, the new window opens it as its first tab.
///
/// Must be `async`: creating a webview from a synchronous command deadlocks the
/// main thread on Windows (tauri#12032), which froze the new window blank.
#[tauri::command]
pub async fn new_window(app: AppHandle, url: Option<String>) -> Result<(), String> {
    let n = app.state::<WindowSeq>().0.fetch_add(1, Ordering::SeqCst);
    let label = format!("w{n}");
    if let Some(u) = url.filter(|u| !u.is_empty()) {
        app.state::<PendingOpen>().0.lock().unwrap().insert(label.clone(), u);
    }
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

/// The calling window's pending "open this url" (consumed once, on startup).
#[tauri::command]
pub fn take_pending_open(window: tauri::Window) -> Option<String> {
    app_state_remove(&window)
}

#[derive(Clone, Serialize)]
pub struct WinBounds {
    label: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Outer bounds of every browser window in *physical* screen pixels — matched
/// against `cursor_position` (also physical) so a dragged tab routes by the
/// window it was dropped over, free of any DPI/CSS-pixel ambiguity.
#[tauri::command]
pub fn window_bounds(app: AppHandle) -> Vec<WinBounds> {
    let mut out = Vec::new();
    for (label, w) in app.webview_windows() {
        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
            out.push(WinBounds {
                label,
                x: pos.x,
                y: pos.y,
                w: size.width as i32,
                h: size.height as i32,
            });
        }
    }
    out
}

/// Global cursor position in *physical* screen pixels (matches `window_bounds`).
/// Read during/at drag since the webview's own drag coordinates are unreliable.
#[tauri::command]
pub fn cursor_position(app: AppHandle) -> (i32, i32) {
    app.cursor_position()
        .map(|p| (p.x.round() as i32, p.y.round() as i32))
        .unwrap_or((i32::MIN, i32::MIN))
}

/// The calling window's content-area origin (physical px) and scale factor — lets
/// the frontend convert the physical cursor into CSS/client coordinates to drive
/// live tab reordering (WebView2 escalates the drag to the OS, so the page never
/// receives dragover/drop; we poll the cursor instead).
#[tauri::command]
pub fn self_geometry(window: tauri::Window) -> (i32, i32, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = window
        .inner_position()
        .unwrap_or(tauri::PhysicalPosition::new(0, 0));
    (pos.x, pos.y, scale)
}

/// Move a dragged tab into another existing window: it opens `url` there (via the
/// same channel ctrl-click uses) and focuses it. The source window drops its tab.
#[tauri::command]
pub fn move_tab_to_window(app: AppHandle, target: String, url: String) {
    let _ = app.emit_to(&target, "browser-new-tab", url);
    if let Some(w) = app.get_webview_window(&target) {
        let _ = w.set_focus();
    }
}

fn app_state_remove(window: &tauri::Window) -> Option<String> {
    window
        .app_handle()
        .state::<PendingOpen>()
        .0
        .lock()
        .unwrap()
        .remove(window.label())
}

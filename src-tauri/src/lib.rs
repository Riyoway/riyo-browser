mod browser;
mod downloads;
mod net;
mod permissions;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, WindowEvent};

/// Set only when the user explicitly quits from the tray, so the close handler
/// knows to really exit instead of hiding to the tray.
struct QuitFlag(AtomicBool);

/// The main window's on-screen position, saved when it parks off-screen for the
/// tray so it can be restored to the same spot.
struct TrayPos(Mutex<Option<(i32, i32)>>);

/// Where the main window parks while "in the tray" — far off every monitor. We
/// move it here (rather than hide/minimize) because keeping the tab webviews
/// alive on a hidden OR minimized window stops the window ever re-showing
/// (tauri#9798); a normal-but-off-screen window dodges that and keeps playback.
const TRAY_OFFSCREEN: PhysicalPosition<i32> = PhysicalPosition::new(-32000, -32000);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitFlag(AtomicBool::new(false)))
        .manage(TrayPos(Mutex::new(None)))
        .manage(downloads::Downloads::new())
        .manage(browser::WindowSeq::new())
        .manage(browser::PendingOpen::new())
        .manage(permissions::Perms::new())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if window.label() == "main" {
                    if !app.state::<QuitFlag>().0.load(Ordering::SeqCst) {
                        // Park off-screen to the tray instead of quitting — keeping
                        // the tab webviews alive so media keeps playing. We don't
                        // hide/minimize (that would block the re-show, tauri#9798);
                        // a normal off-screen window restores by just moving back.
                        api.prevent_close();
                        if let Ok(p) = window.outer_position() {
                            if p.x > -30000 {
                                *app.state::<TrayPos>().0.lock().unwrap() = Some((p.x, p.y));
                            }
                        }
                        let _ = window.set_skip_taskbar(true);
                        let _ = window.set_position(TRAY_OFFSCREEN);
                    }
                } else {
                    // Secondary window: tear down its tabs, then let it close.
                    browser::close_all_tabs(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            browser::browser_tab_show,
            browser::browser_tab_navigate,
            browser::browser_tab_close,
            browser::browser_tab_eval,
            browser::browser_tab_media,
            browser::browser_hide_all,
            browser::new_window,
            browser::take_pending_open,
            browser::window_bounds,
            browser::cursor_position,
            browser::self_geometry,
            browser::move_tab_to_window,
            net::http_get_text,
            permissions::set_permissions,
            downloads::download_enqueue,
            downloads::download_list,
            downloads::download_max_concurrent,
            downloads::download_set_max_concurrent,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_retry,
            downloads::download_cancel,
            downloads::download_remove,
            downloads::download_clear_finished,
            downloads::download_open,
            downloads::download_open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri-browser");
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("tauri-browser")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => {
                app.state::<QuitFlag>().0.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(false);
        // Move back from the off-screen tray spot to where it was.
        if let Some((x, y)) = app.state::<TrayPos>().0.lock().unwrap().take() {
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
        let _ = w.unminimize(); // in case the user minimized it manually
        let _ = w.show();
        let _ = w.set_focus();
        // Tabs stayed alive in the tray; just reposition the active webview.
        let _ = app.emit("main-shown", ());
    }
}

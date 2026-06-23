mod browser;
mod downloads;
mod net;
mod permissions;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, WindowEvent};

/// Set only when the user explicitly quits from the tray, so the close handler
/// knows to really exit instead of hiding to the tray.
struct QuitFlag(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitFlag(AtomicBool::new(false)))
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
                        // Minimize to the tray instead of quitting. We deliberately
                        // do NOT hide() or tear the tabs down: keeping the webviews
                        // alive lets media keep playing in the background, and
                        // minimizing (vs hiding) avoids the hidden-child-webview
                        // re-show bug (tauri#9798). skip_taskbar hides the button.
                        api.prevent_close();
                        let _ = window.minimize();
                        let _ = window.set_skip_taskbar(true);
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
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // Tabs stayed alive in the tray; just reposition the active webview.
        let _ = app.emit("main-shown", ());
    }
}

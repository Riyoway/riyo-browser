mod browser;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, WindowEvent};

/// Set only when the user explicitly quits from the tray, so the close handler
/// knows to really exit instead of hiding to the tray.
struct QuitFlag(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitFlag(AtomicBool::new(false)))
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if !app.state::<QuitFlag>().0.load(Ordering::SeqCst) {
                    // Hide to tray instead of quitting. Tear down the tab webviews
                    // first — child webviews left on a hidden window can block the
                    // re-show (see browser::close_all_tabs).
                    api.prevent_close();
                    browser::close_all_tabs(app);
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            browser::browser_tab_show,
            browser::browser_tab_navigate,
            browser::browser_tab_close,
            browser::browser_tab_eval,
            browser::browser_hide_all,
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
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // Tabs were torn down on hide; let the browser UI recreate the active one.
        let _ = app.emit("main-shown", ());
    }
}

// ABF Desktop — Tauri v2 application
//
// Wraps the ABF dashboard (Next.js) in a native window with:
// - System tray icon with agent status
// - Auto-launch on login (optional)
// - Native keychain for credential storage
// - Embedded ABF runtime (Node.js sidecar)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
fn get_runtime_status() -> serde_json::Value {
    serde_json::json!({
        "status": "running",
        "agents": 0,
        "activeSessions": 0,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![get_runtime_status])
        .setup(|app| {
            // Build tray menu
            let open_item = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let status_item =
                MenuItem::with_id(app, "status", "Agents: 0 active", false, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "─────────", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit ABF", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open_item, &status_item, &separator, &quit_item])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ABF — AI Agent Team")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ABF Desktop");
}

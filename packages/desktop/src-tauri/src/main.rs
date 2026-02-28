// ABF Desktop — Tauri v2 application
//
// Wraps the ABF dashboard (Next.js) in a native window with:
// - System tray icon with agent status
// - Auto-launch on login (optional)
// - Embedded ABF runtime (Node.js sidecar)
// - One-click Ollama installation for local LLM
// - Health polling → auto-load dashboard when ready

// Temporarily disabled for debugging — enables console output on Windows
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Url,
};
use tauri_plugin_shell::ShellExt;

/// Write a line to a debug log file on the user's desktop
fn debug_log(msg: &str) {
    let path = if cfg!(target_os = "windows") {
        let tmp = std::env::var("TEMP")
            .or_else(|_| std::env::var("USERPROFILE").map(|h| format!("{}\\Desktop", h)))
            .unwrap_or_else(|_| "C:\\".to_string());
        format!("{}\\abf-desktop-debug.log", tmp)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        format!("{}/abf-desktop-debug.log", home)
    };

    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{}] {}", timestamp, msg);
    }
}

/// Shared state for the sidecar child process
struct RuntimeState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

// ─── Runtime Commands ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_runtime_status() -> serde_json::Value {
    match reqwest::get("http://localhost:3000/health").await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                return body;
            }
            serde_json::json!({ "status": "running" })
        }
        _ => serde_json::json!({ "status": "stopped" }),
    }
}

#[tauri::command]
async fn start_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<RuntimeState>>>,
) -> Result<String, String> {
    let mut rt = state.lock().map_err(|e| e.to_string())?;
    if rt.child.is_some() {
        return Ok("already running".to_string());
    }

    let cli_path = resolve_cli_path(&app);
    let cli_path_str = cli_path.to_string_lossy().to_string();

    let (mut rx, child) = app
        .shell()
        .command("node")
        .args([&cli_path_str, "dev"])
        .spawn()
        .map_err(|e| format!("Failed to spawn runtime: {}", e))?;

    // Log sidecar output in background
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let _ = app_handle.emit("runtime-log", text.to_string());
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let _ = app_handle.emit("runtime-log", text.to_string());
                }
                CommandEvent::Terminated(status) => {
                    let msg = format!("Runtime exited with {:?}", status);
                    let _ = app_handle.emit("runtime-log", msg);
                    break;
                }
                _ => {}
            }
        }
    });

    rt.child = Some(child);
    Ok("started".to_string())
}

#[tauri::command]
async fn stop_runtime(
    state: tauri::State<'_, Arc<Mutex<RuntimeState>>>,
) -> Result<String, String> {
    let mut rt = state.lock().map_err(|e| e.to_string())?;
    if let Some(child) = rt.child.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill runtime: {}", e))?;
        Ok("stopped".to_string())
    } else {
        Ok("not running".to_string())
    }
}

// ─── Ollama Commands ────────────────────────────────────────────────────────

/// Check if Ollama API is reachable and return installed models
#[tauri::command]
async fn check_ollama() -> serde_json::Value {
    // Check if API is running
    let running = match reqwest::Client::new()
        .get("http://localhost:11434/api/tags")
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let models = body
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.get("name").and_then(|n| n.as_str()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                return serde_json::json!({
                    "installed": true,
                    "running": true,
                    "models": models,
                });
            }
            true
        }
        _ => false,
    };

    if running {
        return serde_json::json!({
            "installed": true,
            "running": true,
            "models": [],
        });
    }

    // Check if binary exists (not running but installed)
    let binary_exists = tokio::process::Command::new("ollama")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    serde_json::json!({
        "installed": binary_exists,
        "running": false,
        "models": [],
    })
}

/// Install Ollama. Returns progress messages via the "ollama-progress" event.
#[tauri::command]
async fn install_ollama(app: tauri::AppHandle) -> Result<bool, String> {
    let _ = app.emit("ollama-progress", "Downloading Ollama...");

    let success = if cfg!(target_os = "windows") {
        // Windows: PowerShell download + run
        let output = tokio::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "$installer = \"$env:TEMP\\OllamaSetup.exe\"; \
                 Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $installer; \
                 Start-Process $installer -Wait",
            ])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;

        output.status.success()
    } else {
        // Linux/macOS: curl install script
        let output = tokio::process::Command::new("sh")
            .args(["-c", "curl -fsSL https://ollama.com/install.sh | sh"])
            .output()
            .await
            .map_err(|e| format!("Install error: {}", e))?;

        output.status.success()
    };

    if success {
        let _ = app.emit("ollama-progress", "Ollama installed successfully");
    } else {
        let _ = app.emit("ollama-progress", "Installation failed");
    }

    Ok(success)
}

/// Start the Ollama server (ollama serve) in the background
#[tauri::command]
async fn start_ollama(app: tauri::AppHandle) -> Result<bool, String> {
    let _ = app.emit("ollama-progress", "Starting Ollama server...");

    // Spawn ollama serve detached
    let _ = tokio::process::Command::new("ollama")
        .arg("serve")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    // Poll until ready
    let client = reqwest::Client::new();
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if let Ok(resp) = client
            .get("http://localhost:11434/api/tags")
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            if resp.status().is_success() {
                let _ = app.emit("ollama-progress", "Ollama server started");
                return Ok(true);
            }
        }
    }

    let _ = app.emit("ollama-progress", "Server failed to start");
    Ok(false)
}

/// Pull a model from the Ollama registry
#[tauri::command]
async fn pull_ollama_model(app: tauri::AppHandle, model: String) -> Result<bool, String> {
    let _ = app.emit(
        "ollama-progress",
        format!("Downloading {}...", model),
    );

    let output = tokio::process::Command::new("ollama")
        .args(["pull", &model])
        .output()
        .await
        .map_err(|e| format!("Pull error: {}", e))?;

    let success = output.status.success();
    if success {
        let _ = app.emit("ollama-progress", format!("{} ready", model));
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = app.emit(
            "ollama-progress",
            format!("Failed to download {}: {}", model, stderr.trim()),
        );
    }

    Ok(success)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Resolve the path to the CLI entry point
fn resolve_cli_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .resource_dir()
        .map(|p| p.join("packages/cli/dist/index.js"))
        .unwrap_or_else(|_| std::path::PathBuf::from("packages/cli/dist/index.js"))
}

// ─── Tray Setup ─────────────────────────────────────────────────────────────

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item =
        MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
    let status_item =
        MenuItem::with_id(app, "status", "Agents: starting...", false, None::<&str>)?;
    let separator =
        MenuItem::with_id(app, "sep", "─────────", false, None::<&str>)?;
    let quit_item =
        MenuItem::with_id(app, "quit", "Quit ABF", true, None::<&str>)?;

    let menu =
        Menu::with_items(app, &[&open_item, &status_item, &separator, &quit_item])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("no default window icon")?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
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
}

// ─── Main ───────────────────────────────────────────────────────────────────

fn main() {
    debug_log("=== ABF Desktop starting ===");

    let runtime_state = Arc::new(Mutex::new(RuntimeState { child: None }));

    debug_log("Building tauri app...");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(runtime_state.clone())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            start_runtime,
            stop_runtime,
            check_ollama,
            install_ollama,
            start_ollama,
            pull_ollama_model
        ])
        .setup(move |app| {
            debug_log("setup() called");

            // Build tray icon — wrapped so failures don't crash the app
            if let Err(e) = setup_tray(app) {
                debug_log(&format!("Tray icon setup failed (non-fatal): {}", e));
            } else {
                debug_log("Tray icon created OK");
            }

            // Emit "app-ready" so the splash page can start its setup flow
            let app_handle = app.handle().clone();
            let state = runtime_state.clone();
            debug_log("Spawning async health-poll task");
            tauri::async_runtime::spawn(async move {
                debug_log("Async task started, emitting app-ready");
                let _ = app_handle.emit("app-ready", true);

                // Wait briefly then check if runtime comes up on its own
                // (The splash page drives the setup flow via Tauri commands)
                // Once the runtime is healthy, navigate to the dashboard
                let client = reqwest::Client::new();
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    if let Ok(resp) =
                        client.get("http://localhost:3000/health").send().await
                    {
                        if resp.status().is_success() {
                            // Runtime is ready — navigate to dashboard
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Ok(url) = Url::parse("http://localhost:3000") {
                                    let _ = window.navigate(url);
                                }
                            }
                            let _ = app_handle.emit("runtime-ready", true);
                            break;
                        }
                    }
                }

                // Keep checking if runtime exits unexpectedly
                loop {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    let has_child = state
                        .lock()
                        .map(|rt| rt.child.is_some())
                        .unwrap_or(false);
                    if !has_child {
                        break;
                    }
                }
            });

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
        .unwrap_or_else(|e| {
            debug_log(&format!("FATAL: tauri run failed: {}", e));
            panic!("error while running ABF Desktop: {}", e);
        });

    debug_log("App exited normally");
}

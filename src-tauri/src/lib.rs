#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashMap,
    env, fs,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_CONNECTOR_RESPONSE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorResponse {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

#[derive(Serialize)]
struct BrowserOption {
    id: &'static str,
    label: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallation {
    kind: &'static str,
    can_self_update: bool,
}

const BROWSERS: [(&str, &str, &str); 6] = [
    ("firefox", "Firefox", "firefox"),
    ("chromium", "Chromium", "chromium"),
    ("google-chrome", "Google Chrome", "google-chrome"),
    ("brave", "Brave", "brave-browser"),
    ("vivaldi", "Vivaldi", "vivaldi"),
    ("microsoft-edge", "Microsoft Edge", "microsoft-edge"),
];

fn executable_exists(name: &str) -> bool {
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|directory| directory.join(name).is_file())
    })
}

#[tauri::command]
fn available_browsers() -> Vec<BrowserOption> {
    let mut options = vec![BrowserOption {
        id: "system",
        label: "System default",
    }];
    options.extend(
        BROWSERS
            .iter()
            .filter(|(_, _, executable)| executable_exists(executable))
            .map(|(id, label, _)| BrowserOption { id, label }),
    );
    options
}

#[tauri::command]
fn update_installation() -> UpdateInstallation {
    if cfg!(debug_assertions) {
        return UpdateInstallation {
            kind: "development",
            can_self_update: false,
        };
    }

    // Tauri's Linux updater replaces the currently running AppImage. Debian
    // packages are owned by APT and must never be overwritten by the app.
    let is_appimage = cfg!(target_os = "linux") && env::var_os("APPIMAGE").is_some();
    UpdateInstallation {
        kind: if is_appimage { "appimage" } else { "package" },
        can_self_update: is_appimage,
    }
}

fn browser_executable(browser: &str) -> Result<&'static str, String> {
    BROWSERS
        .iter()
        .find(|(id, _, _)| *id == browser)
        .map(|(_, _, executable)| *executable)
        .ok_or_else(|| format!("Unsupported browser: {browser}"))
}

#[tauri::command]
fn open_external_url(url: String, browser: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only HTTP and HTTPS links can be opened".to_string());
    }

    let mut command = if browser == "system" {
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
        }
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
        }
        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("cmd");
            command.args(["/C", "start", ""]);
            command
        }
    } else {
        let executable = browser_executable(&browser)?;
        if !executable_exists(executable) {
            return Err(format!("The selected browser is not installed: {browser}"));
        }
        Command::new(executable)
    };

    command
        .arg(parsed.as_str())
        .spawn()
        .map_err(|error| format!("Could not launch the selected browser: {error}"))?;
    Ok(())
}

// Portable backups are complete versioned documents. The frontend validates
// every load through `parseV2Data`, which requires the version and also uses
// `exportedAt` for backup compatibility.
const DATA_AREAS: [&str; 11] = [
    "version",
    "exportedAt",
    "media",
    "episodes",
    "watchEvents",
    "library",
    "collections",
    "collectionEntries",
    "series",
    "seriesEntries",
    "settings",
];

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("platypus.sqlite3"))
}

/// The application's single SQLite connection. It is opened, and migrated,
/// by the first command that needs it; a failed open is retried next time.
#[derive(Default)]
struct Database(Mutex<Option<Connection>>);

fn with_database<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<Database>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "The library database is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(database::open(&database_path(app)?)?);
    }
    operation(guard.as_mut().expect("database connection was just opened"))
}

#[tauri::command]
fn load_app_data(app: AppHandle) -> Result<Option<String>, String> {
    with_database(&app, |connection| {
        Ok(database::load_document(connection)?.map(|document| document.to_string()))
    })
}

#[tauri::command]
fn apply_app_data_changes(app: AppHandle, changes: String) -> Result<(), String> {
    let changes: serde_json::Value =
        serde_json::from_str(&changes).map_err(|error| format!("Invalid changes: {error}"))?;
    with_database(&app, |connection| {
        database::apply_changes(connection, &changes)
    })
}

#[tauri::command]
fn load_sources(app: AppHandle) -> Result<Option<String>, String> {
    with_database(&app, |connection| {
        connection
            .query_row(
                "SELECT data_json FROM source_connections WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn save_sources(app: AppHandle, data: String) -> Result<(), String> {
    let _: serde_json::Value =
        serde_json::from_str(&data).map_err(|error| format!("Invalid source data: {error}"))?;
    with_database(&app, |connection| {
        connection.execute(
            "INSERT INTO source_connections (id, data_json, updated_at) VALUES (1, ?1, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
            [data],
        ).map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn save_backup(app: AppHandle, data: String) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(&data).map_err(|error| format!("Invalid backup data: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Backup data must be a JSON object".to_string())?;
    for area in DATA_AREAS {
        if !object.contains_key(area) {
            return Err(format!("Backup data is missing {area}"));
        }
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backups");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let path = directory.join(format!("platypus-backup-{stamp}.json"));
    let serialized = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(&path, serialized).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_sources_bundle(path: String, data: String) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(&data).map_err(|error| format!("Invalid sources file: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Sources file must be a JSON object".to_string())?;
    if object.get("format").and_then(|value| value.as_str()) != Some("platypus-sources")
        || object.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1)
        || !object.get("sources").is_some_and(|value| value.is_array())
    {
        return Err("Sources file has an unsupported format".to_string());
    }
    let path = PathBuf::from(path);
    if path.as_os_str().is_empty() || path.is_dir() {
        return Err("Choose a valid file path for the sources export".to_string());
    }
    let serialized = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(&path, serialized).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn connector_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    allowed_hosts: Vec<String>,
    timeout_ms: u64,
) -> Result<ConnectorResponse, String> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|error| format!("Invalid source URL: {error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Source URL has no host".to_string())?;
    if !allowed_hosts.iter().any(|allowed| allowed == host) {
        return Err(format!("Request host is not approved: {host}"));
    }
    let local_http = parsed.scheme() == "http" && (host == "localhost" || host == "127.0.0.1");
    if parsed.scheme() != "https" && !local_http {
        return Err("Source requests require HTTPS except on loopback".to_string());
    }
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "Invalid source request method".to_string())?;
    if method != reqwest::Method::GET && method != reqwest::Method::POST {
        return Err("Only GET and POST source requests are supported".to_string());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_millis(
            timeout_ms.clamp(100, 120_000),
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.request(method, parsed);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status().is_redirection() {
        return Err("Source request was redirected; redirects are not permitted".to_string());
    }
    if response.content_length().unwrap_or(0) > MAX_CONNECTOR_RESPONSE_BYTES {
        return Err("Source response exceeded the 10 MiB limit".to_string());
    }
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_CONNECTOR_RESPONSE_BYTES {
        return Err("Source response exceeded the 10 MiB limit".to_string());
    }
    let body = String::from_utf8(bytes.to_vec())
        .map_err(|_| "Source response was not valid UTF-8 JSON".to_string())?;
    Ok(ConnectorResponse {
        status,
        body,
        headers,
    })
}

pub fn run() {
    // WebKitGTK's DMA-BUF renderer fails on a number of Linux graphics stacks
    // (including some Wayland compositors, NVIDIA/virtual GPUs, and XWayland)
    // before the application window can render. PLATYPUS favors a reliable
    // first launch over GPU-backed WebKit compositing.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Database::default())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            apply_app_data_changes,
            load_sources,
            save_sources,
            save_backup,
            save_sources_bundle,
            connector_request,
            available_browsers,
            open_external_url,
            update_installation
        ])
        .run(tauri::generate_context!())
        .expect("error while running PLATYPUS");
}

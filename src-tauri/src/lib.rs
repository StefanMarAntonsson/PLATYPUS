#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
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

// Keep the versioned document intact at the repository boundary. The frontend
// deliberately validates every load through `parseV2Data`, which requires the
// version and also uses `exportedAt` for portable backup compatibility.
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

fn backup_database(path: &Path) -> Result<(), String> {
    if !path.exists() || fs::metadata(path).map_err(|error| error.to_string())?.len() == 0 {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let backup = path.with_file_name(format!("platypus.sqlite3.pre-migration-{stamp}.bak"));
    fs::copy(path, backup).map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate(connection: &mut Connection, path: &Path, database_existed: bool) -> Result<(), String> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        .map_err(|error| error.to_string())?;
    let current: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    // Preserve the pre-upgrade file before any schema change, including a
    // partial upgrade from an earlier PLATYPUS desktop release.
    if database_existed && current < 3 {
        backup_database(path)?;
    }
    if current < 1 {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS app_data (
                area TEXT PRIMARY KEY NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
            )
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, CURRENT_TIMESTAMP)",
            [1],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    if current < 2 {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        // Only opaque identifiers belong here. Actual credential values stay in
        // platform secret storage when connection support is added.
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS secret_references (
                    id TEXT PRIMARY KEY NOT NULL,
                    connection_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, CURRENT_TIMESTAMP)",
                [2],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    if current < 3 {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS source_connections (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
            )
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, CURRENT_TIMESTAMP)", [3],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let database_existed = path.exists();
    let mut connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    migrate(&mut connection, &path, database_existed)?;
    Ok(connection)
}

#[tauri::command]
fn load_app_data(app: AppHandle) -> Result<Option<String>, String> {
    let connection = open_database(&app)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM app_data", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if count == 0 {
        return Ok(None);
    }

    let mut data = serde_json::Map::new();
    let mut statement = connection
        .prepare("SELECT area, value_json FROM app_data")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (area, value) = row.map_err(|error| error.to_string())?;
        let value = serde_json::from_str(&value)
            .map_err(|error| format!("Invalid stored {area} data: {error}"))?;
        data.insert(area, value);
    }
    Ok(Some(serde_json::Value::Object(data).to_string()))
}

#[tauri::command]
fn save_app_data(app: AppHandle, data: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&data)
        .map_err(|error| format!("Invalid application data: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Application data must be a JSON object".to_string())?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for area in DATA_AREAS {
        let area_value = object
            .get(area)
            .ok_or_else(|| format!("Application data is missing {area}"))?;
        transaction.execute(
            "INSERT INTO app_data (area, value_json, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(area) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![area, area_value.to_string()],
        ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_sources(app: AppHandle) -> Result<Option<String>, String> {
    let connection = open_database(&app)?;
    connection
        .query_row(
            "SELECT data_json FROM source_connections WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_sources(app: AppHandle, data: String) -> Result<(), String> {
    let _: serde_json::Value =
        serde_json::from_str(&data).map_err(|error| format!("Invalid source data: {error}"))?;
    let connection = open_database(&app)?;
    connection.execute(
        "INSERT INTO source_connections (id, data_json, updated_at) VALUES (1, ?1, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
        [data],
    ).map_err(|error| error.to_string())?;
    Ok(())
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            load_sources,
            save_sources,
            save_backup,
            save_sources_bundle,
            connector_request,
            available_browsers,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running PLATYPUS");
}

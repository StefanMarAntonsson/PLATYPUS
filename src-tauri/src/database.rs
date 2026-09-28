//! SQLite persistence for the PLATYPUS library.
//!
//! Every kind of record lives in its own table. Identity, relationship, and
//! ordering fields are ordinary indexed columns; the full record is kept as a
//! JSON document next to them so the frontend's versioned record shapes stay
//! intact. The frontend sends change sets containing only the records that
//! changed, and each change set is applied in a single transaction.

use rusqlite::{params_from_iter, types::Value, Connection, OptionalExtension};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub const LATEST_SCHEMA_VERSION: i64 = 4;

#[derive(Clone, Copy)]
enum Kind {
    Number,
    OptionalNumber,
    OptionalText,
}

struct Column {
    name: &'static str,
    field: &'static str,
    kind: Kind,
}

const fn column(name: &'static str, field: &'static str, kind: Kind) -> Column {
    Column { name, field, kind }
}

/// A frontend data area stored in its own table. The first `key_len` columns
/// form the record's unique identity and are required; the other indexed
/// columns tolerate missing values so older stored records always upgrade.
struct Area {
    name: &'static str,
    table: &'static str,
    columns: &'static [Column],
    key_len: usize,
}

const AREAS: [Area; 8] = [
    Area {
        name: "media",
        table: "media",
        columns: &[column("id", "id", Kind::Number)],
        key_len: 1,
    },
    Area {
        name: "episodes",
        table: "episodes",
        columns: &[
            column("id", "id", Kind::Number),
            column("media_id", "mediaId", Kind::Number),
            column("number", "number", Kind::OptionalNumber),
        ],
        key_len: 1,
    },
    Area {
        name: "watchEvents",
        table: "watch_events",
        columns: &[
            column("id", "id", Kind::Number),
            column("media_id", "mediaId", Kind::Number),
            column("episode_id", "episodeId", Kind::OptionalNumber),
            column("watched_at", "watchedAt", Kind::OptionalNumber),
        ],
        key_len: 1,
    },
    Area {
        name: "library",
        table: "library_entries",
        columns: &[
            column("id", "id", Kind::Number),
            column("media_id", "mediaId", Kind::Number),
            column("status", "status", Kind::OptionalText),
        ],
        key_len: 1,
    },
    Area {
        name: "collections",
        table: "collections",
        columns: &[column("id", "id", Kind::Number)],
        key_len: 1,
    },
    Area {
        name: "collectionEntries",
        table: "collection_entries",
        columns: &[
            column("collection_id", "collectionId", Kind::Number),
            column("media_id", "mediaId", Kind::Number),
            column("position", "order", Kind::OptionalNumber),
        ],
        key_len: 2,
    },
    Area {
        name: "series",
        table: "series",
        columns: &[column("id", "id", Kind::Number)],
        key_len: 1,
    },
    Area {
        name: "seriesEntries",
        table: "series_entries",
        columns: &[
            column("series_id", "seriesId", Kind::Number),
            column("media_id", "mediaId", Kind::Number),
            column("position", "order", Kind::OptionalNumber),
        ],
        key_len: 2,
    },
];

fn area(name: &str) -> Result<&'static Area, String> {
    AREAS
        .iter()
        .find(|area| area.name == name)
        .ok_or_else(|| format!("Unknown data area: {name}"))
}

fn sql_error(error: rusqlite::Error) -> String {
    error.to_string()
}

fn number_value(value: &serde_json::Value) -> Option<Value> {
    let number = value.as_number()?;
    if let Some(integer) = number.as_i64() {
        Some(Value::Integer(integer))
    } else {
        number
            .as_f64()
            .filter(|float| float.is_finite())
            .map(Value::Real)
    }
}

fn column_value(area: &Area, column: &Column, record: &serde_json::Value) -> Result<Value, String> {
    let field = record.get(column.field);
    let invalid = || {
        format!(
            "Invalid {} record: {} must be {}",
            area.name,
            column.field,
            match column.kind {
                Kind::Number => "a number",
                Kind::OptionalNumber => "a number or null",
                Kind::OptionalText => "text or null",
            }
        )
    };
    match column.kind {
        Kind::Number => field.and_then(number_value).ok_or_else(invalid),
        Kind::OptionalNumber => match field {
            None | Some(serde_json::Value::Null) => Ok(Value::Null),
            Some(value) => number_value(value).ok_or_else(invalid),
        },
        Kind::OptionalText => match field {
            None | Some(serde_json::Value::Null) => Ok(Value::Null),
            Some(value) => value
                .as_str()
                .map(|text| Value::Text(text.to_string()))
                .ok_or_else(invalid),
        },
    }
}

fn key_columns(area: &Area) -> Vec<&'static str> {
    area.columns[..area.key_len]
        .iter()
        .map(|column| column.name)
        .collect()
}

fn upsert_record(
    connection: &Connection,
    area: &Area,
    record: &serde_json::Value,
) -> Result<(), String> {
    if !record.is_object() {
        return Err(format!("Invalid {} record: expected an object", area.name));
    }
    let mut values = area
        .columns
        .iter()
        .map(|column| column_value(area, column, record))
        .collect::<Result<Vec<_>, _>>()?;
    values.push(Value::Text(record.to_string()));

    let names: Vec<&str> = area.columns.iter().map(|column| column.name).collect();
    let placeholders: Vec<String> = (1..=values.len()).map(|n| format!("?{n}")).collect();
    let updates: Vec<String> = area.columns[area.key_len..]
        .iter()
        .map(|column| column.name)
        .chain(["data_json"])
        .map(|name| format!("{name} = excluded.{name}"))
        .chain(["updated_at = CURRENT_TIMESTAMP".to_string()])
        .collect();
    // ON CONFLICT ... DO UPDATE keeps the row's rowid, so records keep their
    // original position when read back in rowid order.
    let sql = format!(
        "INSERT INTO {table} ({names}, data_json) VALUES ({placeholders})
         ON CONFLICT({keys}) DO UPDATE SET {updates}",
        table = area.table,
        names = names.join(", "),
        placeholders = placeholders.join(", "),
        keys = key_columns(area).join(", "),
        updates = updates.join(", "),
    );
    connection
        .prepare_cached(&sql)
        .and_then(|mut statement| statement.execute(params_from_iter(values)))
        .map_err(sql_error)?;
    Ok(())
}

fn delete_record(
    connection: &Connection,
    area: &Area,
    key: &serde_json::Value,
) -> Result<(), String> {
    let keys = key_columns(area);
    let values = if area.key_len == 1 && key.is_number() {
        vec![number_value(key).ok_or_else(|| format!("Invalid {} key", area.name))?]
    } else {
        area.columns[..area.key_len]
            .iter()
            .map(|column| column_value(area, column, key))
            .collect::<Result<Vec<_>, _>>()?
    };
    let conditions: Vec<String> = keys
        .iter()
        .enumerate()
        .map(|(index, name)| format!("{name} = ?{}", index + 1))
        .collect();
    let sql = format!(
        "DELETE FROM {} WHERE {}",
        area.table,
        conditions.join(" AND ")
    );
    connection
        .prepare_cached(&sql)
        .and_then(|mut statement| statement.execute(params_from_iter(values)))
        .map_err(sql_error)?;
    Ok(())
}

fn save_settings(connection: &Connection, settings: &serde_json::Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Settings must be an object".to_string());
    }
    connection
        .execute(
            "INSERT INTO settings (id, data_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP",
            [settings.to_string()],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn object_entries<'a>(
    changes: &'a serde_json::Map<String, serde_json::Value>,
    section: &str,
) -> Result<Vec<(&'static Area, &'a Vec<serde_json::Value>)>, String> {
    match changes.get(section) {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(serde_json::Value::Object(areas)) => areas
            .iter()
            .map(|(name, records)| {
                let records = records
                    .as_array()
                    .ok_or_else(|| format!("{section}.{name} must be an array"))?;
                Ok((area(name)?, records))
            })
            .collect(),
        Some(_) => Err(format!("{section} must be an object")),
    }
}

/// Apply a change set in one transaction:
///
/// ```json
/// { "replace":  { "collectionEntries": [ ...every record... ] },
///   "delete":   { "episodes": [12, 13] },
///   "upsert":   { "episodes": [ { "id": 14, ... } ] },
///   "settings": { ... } }
/// ```
///
/// `replace` rewrites an entire area, `delete` removes records by key, and
/// `upsert` inserts or updates individual records. Nothing is written if any
/// part of the change set is invalid.
pub fn apply_changes(
    connection: &mut Connection,
    changes: &serde_json::Value,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(sql_error)?;
    write_changes(&transaction, changes)?;
    transaction.commit().map_err(sql_error)
}

fn write_changes(transaction: &Connection, changes: &serde_json::Value) -> Result<(), String> {
    let changes = changes
        .as_object()
        .ok_or_else(|| "Changes must be a JSON object".to_string())?;

    for (area, records) in object_entries(changes, "replace")? {
        transaction
            .execute(&format!("DELETE FROM {}", area.table), [])
            .map_err(sql_error)?;
        for record in records {
            upsert_record(transaction, area, record)?;
        }
    }
    for (area, keys) in object_entries(changes, "delete")? {
        for key in keys {
            delete_record(transaction, area, key)?;
        }
    }
    for (area, records) in object_entries(changes, "upsert")? {
        for record in records {
            upsert_record(transaction, area, record)?;
        }
    }
    match changes.get("settings") {
        None | Some(serde_json::Value::Null) => Ok(()),
        Some(settings) => save_settings(transaction, settings),
    }
}

/// A change set that rewrites every area from a complete library document.
pub fn replace_all_changes(document: &serde_json::Value) -> Result<serde_json::Value, String> {
    let object = document
        .as_object()
        .ok_or_else(|| "Application data must be a JSON object".to_string())?;
    let mut replace = serde_json::Map::new();
    for area in &AREAS {
        let records = match object.get(area.name) {
            None | Some(serde_json::Value::Null) => serde_json::Value::Array(Vec::new()),
            Some(records @ serde_json::Value::Array(_)) => records.clone(),
            Some(_) => return Err(format!("{} must be an array", area.name)),
        };
        replace.insert(area.name.to_string(), records);
    }
    let mut changes = serde_json::Map::new();
    changes.insert("replace".to_string(), serde_json::Value::Object(replace));
    if let Some(settings) = object.get("settings").filter(|value| !value.is_null()) {
        changes.insert("settings".to_string(), settings.clone());
    }
    Ok(serde_json::Value::Object(changes))
}

/// Read the whole library as one versioned document, or `None` when nothing
/// has been stored yet.
pub fn load_document(connection: &Connection) -> Result<Option<serde_json::Value>, String> {
    let mut document = serde_json::Map::new();
    document.insert("version".to_string(), 2.into());
    document.insert("exportedAt".to_string(), "".into());
    let mut empty = true;

    for area in &AREAS {
        let mut statement = connection
            .prepare(&format!(
                "SELECT data_json FROM {} ORDER BY rowid",
                area.table
            ))
            .map_err(sql_error)?;
        let records = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_error)?
            .map(|row| {
                let text = row.map_err(sql_error)?;
                serde_json::from_str(&text)
                    .map_err(|error| format!("Invalid stored {} record: {error}", area.name))
            })
            .collect::<Result<Vec<serde_json::Value>, String>>()?;
        empty &= records.is_empty();
        document.insert(area.name.to_string(), serde_json::Value::Array(records));
    }

    let settings: Option<String> = connection
        .query_row("SELECT data_json FROM settings WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(sql_error)?;
    if let Some(settings) = settings {
        empty = false;
        let settings = serde_json::from_str(&settings)
            .map_err(|error| format!("Invalid stored settings: {error}"))?;
        document.insert("settings".to_string(), settings);
    }

    Ok((!empty).then_some(serde_json::Value::Object(document)))
}

fn backup_database(connection: &Connection, path: &Path) -> Result<(), String> {
    if fs::metadata(path).map_or(true, |metadata| metadata.len() == 0) {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let backup = path.with_file_name(format!("platypus.sqlite3.pre-migration-{stamp}.bak"));
    // VACUUM INTO writes a consistent copy that includes pending WAL content.
    connection
        .execute("VACUUM INTO ?1", [backup.to_string_lossy()])
        .map_err(sql_error)?;
    Ok(())
}

fn record_migration(connection: &Connection, version: i64) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, CURRENT_TIMESTAMP)",
            [version],
        )
        .map_err(sql_error)?;
    Ok(())
}

const RECORD_TABLES_SQL: &str = "
    CREATE TABLE media (
        id INTEGER NOT NULL UNIQUE,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE episodes (
        id INTEGER NOT NULL UNIQUE,
        media_id INTEGER NOT NULL,
        number REAL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX episodes_by_media ON episodes (media_id, number);
    CREATE TABLE watch_events (
        id INTEGER NOT NULL UNIQUE,
        media_id INTEGER NOT NULL,
        episode_id INTEGER,
        watched_at REAL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX watch_events_by_media ON watch_events (media_id);
    CREATE INDEX watch_events_by_episode ON watch_events (episode_id);
    CREATE TABLE library_entries (
        id INTEGER NOT NULL UNIQUE,
        media_id INTEGER NOT NULL,
        status TEXT,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX library_entries_by_media ON library_entries (media_id);
    CREATE INDEX library_entries_by_status ON library_entries (status);
    CREATE TABLE collections (
        id INTEGER NOT NULL UNIQUE,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE collection_entries (
        collection_id INTEGER NOT NULL,
        media_id INTEGER NOT NULL,
        position REAL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (collection_id, media_id)
    );
    CREATE TABLE series (
        id INTEGER NOT NULL UNIQUE,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE series_entries (
        series_id INTEGER NOT NULL,
        media_id INTEGER NOT NULL,
        position REAL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (series_id, media_id)
    );
    CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
";

/// Move the version 1-3 document rows into the per-record tables.
fn split_app_data(connection: &Connection) -> Result<(), String> {
    let mut document = serde_json::Map::new();
    {
        let mut statement = connection
            .prepare("SELECT area, value_json FROM app_data")
            .map_err(sql_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?;
        for row in rows {
            let (name, value) = row.map_err(sql_error)?;
            let value = serde_json::from_str(&value)
                .map_err(|error| format!("Invalid stored {name} data: {error}"))?;
            document.insert(name, value);
        }
    }
    // Early builds stored curated collections as "series" only.
    if !document.contains_key("collections") {
        if let Some(series) = document.get("series").cloned() {
            document.insert("collections".to_string(), series);
        }
    }
    if !document.contains_key("collectionEntries") {
        if let Some(serde_json::Value::Array(entries)) = document.get("seriesEntries") {
            let entries = entries
                .iter()
                .map(|entry| {
                    let mut entry = entry.clone();
                    if let Some(object) = entry.as_object_mut() {
                        if !object.contains_key("collectionId") {
                            if let Some(series_id) = object.get("seriesId").cloned() {
                                object.insert("collectionId".to_string(), series_id);
                            }
                        }
                    }
                    entry
                })
                .collect();
            document.insert(
                "collectionEntries".to_string(),
                serde_json::Value::Array(entries),
            );
        }
    }
    let changes = replace_all_changes(&serde_json::Value::Object(document))?;
    write_changes(connection, &changes)
}

pub fn migrate(connection: &mut Connection, path: Option<&Path>) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        )
        .map_err(sql_error)?;
    let current: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(sql_error)?;

    // Preserve the pre-upgrade file before any schema change, including a
    // partial upgrade from an earlier PLATYPUS desktop release.
    if current > 0 && current < LATEST_SCHEMA_VERSION {
        if let Some(path) = path {
            backup_database(connection, path)?;
        }
    }

    if current < 1 {
        let transaction = connection.transaction().map_err(sql_error)?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS app_data (
                    area TEXT PRIMARY KEY NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )
            .map_err(sql_error)?;
        record_migration(&transaction, 1)?;
        transaction.commit().map_err(sql_error)?;
    }

    if current < 2 {
        let transaction = connection.transaction().map_err(sql_error)?;
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
            .map_err(sql_error)?;
        record_migration(&transaction, 2)?;
        transaction.commit().map_err(sql_error)?;
    }

    if current < 3 {
        let transaction = connection.transaction().map_err(sql_error)?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS source_connections (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )
            .map_err(sql_error)?;
        record_migration(&transaction, 3)?;
        transaction.commit().map_err(sql_error)?;
    }

    if current < 4 {
        // Create the tables, copy the document rows, and drop the old table
        // in one transaction so an interrupted upgrade leaves version 3 intact.
        let transaction = connection.transaction().map_err(sql_error)?;
        transaction
            .execute_batch(RECORD_TABLES_SQL)
            .map_err(sql_error)?;
        split_app_data(&transaction)
            .map_err(|error| format!("Could not upgrade the library database: {error}"))?;
        transaction
            .execute_batch("DROP TABLE app_data")
            .map_err(sql_error)?;
        record_migration(&transaction, 4)?;
        transaction.commit().map_err(sql_error)?;
    }
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(sql_error)?;
    configure(&connection)?;
    migrate(&mut connection, Some(path))?;
    Ok(connection)
}

pub fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(sql_error)?;
    connection
        .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(sql_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory_database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        configure(&connection).unwrap();
        migrate(&mut connection, None).unwrap();
        connection
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("platypus-{name}-{stamp}"));
        fs::create_dir_all(&directory).unwrap();
        directory.join("platypus.sqlite3")
    }

    fn episode(id: i64, number: i64, watched: bool) -> serde_json::Value {
        json!({ "id": id, "mediaId": 1, "number": number, "watched": watched })
    }

    fn areas(connection: &Connection) -> serde_json::Value {
        load_document(connection).unwrap().unwrap()
    }

    #[test]
    fn fresh_database_is_empty_and_current() {
        let connection = memory_database();
        assert!(load_document(&connection).unwrap().is_none());
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn upserts_and_deletes_individual_records_in_place() {
        let mut connection = memory_database();
        apply_changes(
            &mut connection,
            &json!({ "upsert": { "episodes": [episode(3, 1, false), episode(1, 2, false), episode(2, 3, false)] } }),
        )
        .unwrap();
        apply_changes(
            &mut connection,
            &json!({ "upsert": { "episodes": [episode(1, 2, true)] }, "delete": { "episodes": [2] } }),
        )
        .unwrap();

        // Updated records keep their original position.
        assert_eq!(
            areas(&connection)["episodes"],
            json!([episode(3, 1, false), episode(1, 2, true)])
        );
    }

    #[test]
    fn replaces_whole_areas_and_settings() {
        let mut connection = memory_database();
        let entry = |collection: i64, media: i64| json!({ "collectionId": collection, "mediaId": media, "order": 1 });
        apply_changes(
            &mut connection,
            &json!({ "replace": { "collectionEntries": [entry(1, 1), entry(1, 2)] }, "settings": { "autoSync": true } }),
        )
        .unwrap();
        apply_changes(
            &mut connection,
            &json!({ "replace": { "collectionEntries": [entry(2, 5)] } }),
        )
        .unwrap();

        let document = areas(&connection);
        assert_eq!(document["collectionEntries"], json!([entry(2, 5)]));
        assert_eq!(document["settings"], json!({ "autoSync": true }));
        assert_eq!(document["version"], json!(2));
    }

    #[test]
    fn invalid_change_sets_write_nothing() {
        let mut connection = memory_database();
        let result = apply_changes(
            &mut connection,
            &json!({ "upsert": { "episodes": [episode(1, 1, false), { "id": 2, "number": 2 }] } }),
        );
        assert!(result.unwrap_err().contains("mediaId"));
        assert!(load_document(&connection).unwrap().is_none());

        let unknown = apply_changes(&mut connection, &json!({ "upsert": { "nope": [] } }));
        assert!(unknown.unwrap_err().contains("Unknown data area"));
    }

    #[test]
    fn upgrades_a_version_3_document_database_with_a_backup() {
        let path = temp_path("upgrade");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                     INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x'), (3, 'x');
                     CREATE TABLE app_data (area TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                     CREATE TABLE secret_references (id TEXT PRIMARY KEY NOT NULL, connection_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                     CREATE TABLE source_connections (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
                )
                .unwrap();
            let rows = json!({
                "version": 2,
                "exportedAt": "2026-01-01T00:00:00.000Z",
                "media": [{ "id": 7, "titleRomaji": "Seven" }],
                "episodes": [{ "id": 70, "mediaId": 7, "number": 1, "watched": true }],
                "watchEvents": [{ "id": 1, "mediaId": 7, "episodeId": 70, "watchedAt": 1000 }],
                "library": [{ "id": 1, "mediaId": 7, "status": "WATCHING" }],
                "series": [{ "id": 4, "name": "Old collection" }],
                "seriesEntries": [{ "seriesId": 4, "mediaId": 7, "order": 1 }],
                "settings": { "autoSync": false }
            });
            for (area, value) in rows.as_object().unwrap() {
                connection
                    .execute(
                        "INSERT INTO app_data (area, value_json) VALUES (?1, ?2)",
                        [area.clone(), value.to_string()],
                    )
                    .unwrap();
            }
        }

        let connection = open(&path).unwrap();
        let document = areas(&connection);
        assert_eq!(
            document["media"],
            json!([{ "id": 7, "titleRomaji": "Seven" }])
        );
        assert_eq!(document["episodes"][0]["watched"], json!(true));
        assert_eq!(document["watchEvents"][0]["episodeId"], json!(70));
        assert_eq!(document["library"][0]["status"], json!("WATCHING"));
        assert_eq!(
            document["collections"],
            json!([{ "id": 4, "name": "Old collection" }])
        );
        assert_eq!(document["collectionEntries"][0]["collectionId"], json!(4));
        assert_eq!(document["settings"], json!({ "autoSync": false }));

        let legacy_table: Option<String> = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE name = 'app_data'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(legacy_table.is_none());

        let backups = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("pre-migration")
            })
            .count();
        assert_eq!(backups, 1);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_upgrade_keeps_the_version_3_data() {
        let path = temp_path("failed-upgrade");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                     INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x'), (3, 'x');
                     CREATE TABLE app_data (area TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                     INSERT INTO app_data (area, value_json) VALUES ('episodes', '[{\"id\": 1}]');",
                )
                .unwrap();
        }

        assert!(open(&path).is_err());
        let connection = Connection::open(&path).unwrap();
        let stored: String = connection
            .query_row(
                "SELECT value_json FROM app_data WHERE area = 'episodes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "[{\"id\": 1}]");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}

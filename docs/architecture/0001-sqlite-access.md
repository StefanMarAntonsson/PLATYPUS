# ADR 0001: SQLite access through repositories

Status: Accepted for the first desktop release.

The Tauri backend owns the SQLite connection and versioned migrations. Frontend application services use typed repository interfaces exposed by narrow Tauri commands; Svelte code does not issue SQL or mutate a persisted global object. Multi-record changes and imports run in backend transactions.

This keeps database privileges out of remote-content-facing UI code, makes transaction boundaries explicit, and permits repository tests against temporary databases. SQLite is authoritative; provider caches and observations never replace canonical local records implicitly.

## Storage layout (schema version 4)

Each kind of library record has its own table (`media`, `episodes`, `watch_events`, `library_entries`, `collections`, `collection_entries`, `series`, `series_entries`, plus a single-row `settings` table). Identity, relationship, and ordering fields are indexed columns; the full record is stored beside them as JSON so the versioned record shapes stay intact. Upgrading from version 3 splits the old `app_data` documents into these tables in one transaction, after writing a `VACUUM INTO` copy of the database.

The frontend records which records each mutation touched and sends a change set (`upsert`, `delete`, or whole-area `replace`) through `apply_app_data_changes`, so a single episode tick writes one episode row and its watch event rather than the whole library. The native layer keeps one connection with a busy timeout and WAL journaling, and runs migrations once when that connection opens.

Still to do: move to UUID identifiers (ADR 0004), add foreign keys once identifiers are stable, and let the frontend request view data instead of loading the whole library.

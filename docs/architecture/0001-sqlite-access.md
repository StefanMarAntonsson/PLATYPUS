# ADR 0001: SQLite access through repositories

Status: Accepted for the first desktop release.

The Tauri backend owns the SQLite connection and versioned migrations. Frontend application services use typed repository interfaces exposed by narrow Tauri commands; Svelte code does not issue SQL or mutate a persisted global object. Multi-record changes and imports run in backend transactions.

This keeps database privileges out of remote-content-facing UI code, makes transaction boundaries explicit, and permits repository tests against temporary databases. SQLite is authoritative; provider caches and observations never replace canonical local records implicitly.

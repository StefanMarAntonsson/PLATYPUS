# ADR 0002: Secrets are referenced, not persisted

Status: Accepted for the first desktop release.

Connection records store opaque secret references. Secret values live in the operating-system keyring through Tauri's keyring integration; Stronghold is the fallback where a suitable keyring is unavailable. Source templates declare only stable secret field names such as `apiKey`.

Credential interpolation and HTTP execution occur in the Tauri backend. Secrets are scoped to the connection's approved hosts, withheld across unapproved redirects, redacted from diagnostics, and excluded from templates, backups, frontend state, and SQLite.

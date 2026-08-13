# PLATYPUS Desktop Rewrite Plan

## Status

Active implementation roadmap. The Linux desktop shell, SQLite repository, generalized media model, manual tracking, connector foundations, unified search, version 2 import, and release workflow are implemented. Remaining work is focused on hardening, authenticated sources, synchronization, and release verification.

This document records the architecture and remaining path for the Linux-first desktop application. The former GitHub Pages deployment has been retired.

## Product Direction

PLATYPUS is a source-neutral personal media tracker.

The application will own the user's library, watch history, collections, settings, and manual edits. External APIs will be optional user-configured sources that contribute metadata or synchronize tracking information. No particular metadata provider will define PLATYPUS's internal identity or data model.

The primary platform will be Linux, with Arch Linux as the main development and support target. The application will use Tauri 2 for the desktop runtime, retain Svelte for the interface, and use SQLite as its authoritative data store.

## Goals

- Run as a standalone Linux desktop application without requiring a browser.
- Track movies, series, seasons, and episodes.
- Support planned, watching, paused, dropped, completed, and historical viewing states.
- Store the library locally while importing catalog metadata and artwork from user-configured public sources.
- Let users define, configure, test, import, and export API source templates.
- Support multiple enabled sources at the same time.
- Normalize differently shaped API responses into a stable PLATYPUS model.
- Show source capabilities, health, and item-level data completeness separately.
- Preserve the user's library if a source is disabled, removed, unavailable, or changed.
- Keep API credentials local and outside normal exports and backups.
- Provide safe migration from the current version 2 JSON data.
- Package cleanly for Arch Linux and provide a portable Linux build.

## Non-Goals for the First Desktop Release

- Executing arbitrary JavaScript or native code from source templates.
- Automatically understanding an API from only a base URL or API key.
- Supporting every authentication or request-signing scheme.
- Providing a hosted synchronization service or PLATYPUS account.
- Synchronizing watch history bidirectionally in the first connector milestone.
- Replacing the existing Svelte interface with a native GTK interface.
- Maintaining feature parity with GitHub Pages when it conflicts with the desktop design.

## Guiding Principles

1. **Local data is authoritative.** Sources enrich or synchronize the local library; they do not own it.
2. **Internal IDs are provider-independent.** No AniList, TMDB, IMDb, or other remote ID may be used as a PLATYPUS primary key.
3. **The library remains local.** Imported media and tracking remain usable when sources are offline, removed, or unavailable.
4. **Source definitions are data, not executable code.** Imported templates are untrusted declarative configuration.
5. **Secrets are scoped.** Credentials belong to one connection and its permitted hosts.
6. **Capabilities are explicit and testable.** Configured support and actual result completeness are different concepts.
7. **Synchronization is reversible and observable.** Users should be able to see where data came from and diagnose failures.
8. **Migrations preserve user data.** Invalid imports must never silently replace an existing library.

## Target Architecture

```text
Svelte views and components
        |
        v
Application services
library / history / search / collections / source management
        |
        v
Repository and connector interfaces
        |                         |
        v                         v
SQLite repository          Connector engine
        |                   requests / mapping / validation
        |                         |
        +------------+------------+
                     v
              Tauri desktop layer
       filesystem / secrets / HTTP / dialogs /
       opener / notifications / logs / window state
```

The Svelte UI should communicate with typed application services rather than mutating a globally persisted object directly. Services will use repositories for local data and the connector engine for external data.

## Terminology

### Source Template

A portable, declarative description of how an API works. It defines requests, response mappings, supported operations, attribution, cache policy, and required credentials. It never contains a user's secret values.

### Connection

A user's configured instance of a source template. It contains local settings such as base URL, secret references, language, region, enabled state, and synchronization preferences.

### Provider

An internal umbrella term for source templates and connections. The user interface should normally use the clearer terms **Source** and **Connection**.

### Capability

An operation a source may perform, such as searching movies, retrieving episodes, reading watch history, or updating a remote rating.

### Provider Record

The normalized and optionally cached observation received from a connection. A provider record is linked to, but is not itself, the canonical PLATYPUS media item.

## Domain Model

### Canonical Media

The initial canonical entity hierarchy will be:

```text
MediaItem: movie | series
Series
└── Season
    └── Episode
```

Movies and series share top-level fields where practical. Season and episode data remain optional because not every source supports them.

Recommended top-level media fields:

- Internal UUID or other provider-independent ID
- Kind: `movie` or `series`
- Default title
- Original title
- Localized titles
- Overview
- Original language
- Release, start, and end dates
- Runtime, when applicable
- Lifecycle status
- Genres
- Artwork references
- Created and updated timestamps

Provider-specific fields should not be added to the canonical table. They belong in provider records or explicitly typed extensions.

### Provider Identity

Every media entity may have multiple remote identities:

```text
ProviderLink
- Internal entity ID
- Connection or identity namespace
- Remote entity ID
- Remote media kind
- Canonical provider URL
- Last successful synchronization timestamp
```

Duplicate detection must prefer shared external identifiers. Title, year, and runtime may produce suggestions but must not silently merge records without adequate confidence.

Users must be able to link and unlink records manually.

### Library State

Store user intent separately from computed progress.

User-selected statuses:

- Planned
- Watching
- Paused
- Dropped
- Completed

Computed progress states:

- Unstarted
- In progress
- Caught up
- Finished

An ongoing series can therefore be `watching` and `caught up` without being marked completed.

### Watch Events

Viewing history will use events instead of only watched booleans:

```text
WatchEvent
- Internal ID
- Movie or episode ID
- Watched timestamp
- Completion or progress value
- Optional duration/position
- Originating connection
- Optional remote event ID
- Created and modified timestamps
```

This supports rewatches, dated history, imported playback progress, statistics, and future synchronization. A convenience watched state may be derived for UI performance.

### Manual Overrides and Provenance

Displayed fields resolve in this order:

1. Manual override
2. User-selected preferred source
3. Best available provider value
4. Unknown

PLATYPUS should retain the origin of provider-supplied fields. Disabling a connection must not erase local values or watch history.

## Proposed SQLite Areas

The exact schema will be designed through versioned migrations. Expected tables or equivalent structures include:

- `media_items`
- `seasons`
- `episodes`
- `localized_titles`
- `library_entries`
- `watch_events`
- `collections`
- `collection_items`
- `source_templates`
- `connections`
- `provider_links`
- `provider_records`
- `provider_field_values` or equivalent provenance storage
- `capability_status`
- `sync_cursors`
- `request_cache`
- `settings`
- `schema_migrations`

Secrets must not be stored in these tables. Store only opaque secret references.

## Source Template System

### Template and Connection Separation

Source templates should be importable and exportable as versioned `.platypus-source.json` files. Connection settings remain local. Template exports must exclude credentials, tokens, personal base URLs unless explicitly requested, and connection state.

An illustrative template structure:

```json
{
  "schemaVersion": 1,
  "id": "example-catalog",
  "name": "Example Catalog",
  "baseUrl": "https://api.example.com",
  "authentication": {
    "type": "bearer",
    "token": "${secret.apiToken}"
  },
  "operations": {
    "search": {
      "method": "GET",
      "path": "/search",
      "query": {
        "query": "${input.query}",
        "type": "${input.mediaKind}"
      },
      "resultsPath": "$.results",
      "mapping": {
        "providerId": "$.id",
        "kind": "$.type",
        "title": "$.title",
        "releaseDate": "$.release_date",
        "posterUrl": "$.images.poster"
      }
    }
  }
}
```

The final schema must be documented, versioned, validated before storage, and designed for forward-compatible additions.

### Initial Protocol Support

The first connector version should support:

- REST-style JSON APIs
- GraphQL over HTTP using request templates
- GET and POST requests
- Query, header, path, and body interpolation
- No authentication
- API keys in a header or query parameter
- Bearer tokens
- Basic authentication
- Configurable pagination
- Timeouts, retries, and rate-limit backoff
- Declarative extraction and mapping expressions
- Response schema validation

Deferred protocol features:

- OAuth 2 PKCE and device authorization
- Multipart uploads
- Webhooks
- WebSockets
- Custom cryptographic request signing
- Arbitrary scripts

### Initial Catalog Operations

- Search
- Details
- Seasons
- Episodes
- External IDs
- Images
- Release and airing dates
- Availability or external watch links

Each operation is optional. Search-only and history-only connections are valid.

### Later Tracking Operations

- Read watchlist
- Read watch history
- Read playback progress
- Mark watched
- Remove watched state
- Update progress
- Read and write ratings
- Read and write lists
- Incremental synchronization

Tracking operations require an explicit conflict policy and idempotency design before implementation.

## Capability Model

The UI must distinguish three layers.

### Declared Capability

Whether the template contains an operation definition.

### Verified Capability State

- Unsupported
- Configured
- Verified
- Degraded
- Failing

Verification runs a safe test request using user-provided sample input and validates that the normalized result satisfies the operation contract.

### Item-Level Completeness

Whether a particular result actually supplied an optional field. A source may support posters while a particular movie has no poster.

Capability displays should include the last successful test, last error, and whether authentication is currently valid.

## Source Builder Experience

The Add Source wizard should guide a user through:

1. Name, description, and base URL
2. Allowed API and asset hosts
3. Authentication type and required secret fields
4. Request method, path, query, headers, and body
5. Test request execution
6. JSON response preview
7. Result-array selection
8. Field mapping into normalized PLATYPUS data
9. Pagination and rate-limit behavior
10. Attribution and license information
11. Capability verification
12. Save, enable, and optional template export

The visual builder is the primary interface. An advanced raw template editor can be added after schema validation and useful error reporting exist.

## Search and Result Handling

Unified search will:

- Query every enabled connection with a verified compatible search capability.
- Filter by movies, series, or all supported media.
- Display results incrementally as connections respond.
- Label every result with its connection.
- Show source failures without failing the entire search.
- Support per-source timeouts and cancellation.
- Group only confidently linked duplicates.
- Allow users to add a result separately, link it to an existing item, or unlink an incorrect match.
- Add selected results to the local library without making the source authoritative over local tracking data.

Search caching must respect each source template's declared cache policy and attribution requirements.

## Request and Mapping Pipeline

```text
User action
    |
Validate operation input
    |
Resolve connection and allowed hosts
    |
Inject scoped credentials in Tauri backend
    |
Execute request with timeout/rate limit/retry policy
    |
Validate response size and content type
    |
Apply declarative mapping
    |
Validate normalized PLATYPUS result
    |
Return data and update capability health
```

Malformed source responses must not modify canonical data. Store new provider observations and apply merges in a transaction.

## Security Model

Imported source templates are untrusted.

Required controls:

- Perform connector HTTP requests through the Tauri backend.
- Use HTTPS by default.
- Require explicit user approval for local HTTP connections.
- Restrict credentials to the connection's configured hosts.
- Do not forward secrets across unapproved redirects.
- Block `file:`, shell, and other unrelated protocols.
- Limit response sizes and request duration.
- Scope image and asset hosts separately from API hosts.
- Never expose raw secrets to Svelte page code.
- Store credentials in the OS keyring or Tauri Stronghold.
- Exclude secrets from logs, diagnostics, backups, and template exports.
- Use a restrictive Content Security Policy and minimal Tauri capabilities.
- Sanitize or render as plain text any HTML received from a source.
- Never allow source templates to execute shell commands or arbitrary code.
- Show a permission summary before importing or activating a template.

OAuth support must favor PKCE or device authorization. A client secret embedded in a distributed desktop application must not be treated as confidential.

## Desktop Runtime

### Retained Frontend

- Svelte 5
- SvelteKit in client-side static/SPA mode unless migration to plain Svelte becomes clearly beneficial
- Tailwind CSS
- Existing reusable components and layout patterns

### Tauri Responsibilities

- Application window and lifecycle
- SQLite access
- Scoped connector HTTP requests
- Secret storage
- Native open/save dialogs
- External URL opening
- Native notifications
- Logging and diagnostics
- Window-state persistence
- Single-instance behavior
- Updates, when release signing is established

### Linux Distribution

Initial targets:

- Debian package for Debian and Ubuntu systems
- AppImage as a portable Linux artifact

Later targets may include RPM and Flatpak packages. GitHub release automation currently builds AppImage and Debian packages.

Testing must include current Arch Linux on Wayland and X11. At least one mainstream non-Arch distribution should be used to validate the portable build.

## Migration from Version 2

The importer must:

- Parse without modifying the source file.
- Validate the document version and structure.
- Report validation problems before importing anything.
- Import into a new SQLite transaction.
- Assign new provider-independent internal IDs.
- Preserve AniList IDs as provider links.
- Preserve MAL IDs as external provider links when present.
- Convert media, episodes, library status, score, notes, timestamps, and settings.
- Convert watched timestamps into watch events when possible.
- Preserve skipped episode state.
- Preserve collections and series data without silent merging or loss.
- Produce a migration summary with imported, skipped, and conflicting records.
- Roll back the entire migration on an unrecoverable error.
- Create a backup before replacing an existing desktop database.

Before the schema is finalized, decide whether the current Collections and Series concepts remain distinct. The migration must support both regardless of that decision.

The existing JSON export format should remain readable. A new versioned backup format may include normalized SQLite data but should still be portable and documented.

## Implementation Phases

### Working Convention

Commit the completed and validated work after each implementation phase. Do not push those commits unless explicitly requested.

### Phase 0: Contracts and Decisions

- Freeze terminology and first-release scope.
- Define normalized domain types.
- Define source template schema version 1.
- Define capability and validation result types.
- Decide Collections versus Series semantics.
- Write architecture decisions for SQLite access, secret storage, mapping expressions, and internal ID format.

**Exit criteria:** Domain and connector contracts are documented well enough to build independently from provider-specific assumptions.

### Phase 1: Characterize and Protect Current Behavior

- Add tests for JSON parsing and migration behavior.
- Add tests for library status and episode state transitions.
- Add tests for sync retries and partial failures.
- Add representative version 2 fixtures.
- Fix the invalid-file overwrite behavior.
- Establish a no-data-loss regression suite.

**Exit criteria:** Existing data can be loaded, exercised, and migrated through repeatable tests.

### Phase 2: Tauri Desktop Shell

- Add the Tauri 2 project.
- Configure SvelteKit output for the desktop target.
- Remove the Chromium File System Access requirement from the desktop build.
- Add native window metadata, icons, logs, and development commands.
- Establish Arch development prerequisites and documentation.

**Exit criteria:** The existing UI runs as a local Arch Linux desktop application and builds through Vite+ and Tauri.

### Phase 3: SQLite and Repository Layer

- Add versioned SQLite migrations.
- Introduce repository interfaces.
- Move settings and library data behind repositories.
- Add transactional writes and backup behavior.
- Add secret references without storing secrets in SQLite.
- Remove direct file-handle persistence from the desktop application.

**Exit criteria:** A manually populated library survives restarts without JSON file selection or browser storage.

### Phase 4: Generalized Media and History

- Replace anime-specific canonical types.
- Add movies, series, seasons, and episodes.
- Add watch events and computed progress.
- Add local editing for source-imported media.
- Generalize library cards, details, filters, and progress displays.
- Remove remote-ID assumptions from route and episode identifiers.

**Exit criteria:** Users can import movies and series from a public source and track them locally.

### Phase 5: Read-Only Connector Engine

- Implement template loading and schema validation.
- Implement scoped requests and credential injection.
- Implement REST and GraphQL request templates.
- Implement declarative response mapping.
- Implement capability verification and connection health.
- Implement safe caching, pagination, retries, and rate limiting.

**Exit criteria:** A user-authored template can search and retrieve normalized metadata without provider-specific application code.

### Phase 6: Source Builder and Unified Search

- Build Add Source and Edit Source workflows.
- Add request testing and JSON response preview.
- Add visual field mapping.
- Add template import/export and permission review.
- Replace AniList-specific search with multi-connection search.
- Add result grouping, linking, and manual fallback.

**Exit criteria:** A user can configure two structurally different APIs and search both from the same interface.

### Phase 7: Version 2 Migration

- Implement dry-run migration reporting.
- Import canonical items, provider links, progress, history, collections, and settings.
- Add conflict handling and rollback tests.
- Verify representative real-world backups.

**Exit criteria:** Existing PLATYPUS users can migrate without losing tracking data.

### Phase 8: Tracking Connections

- Add OAuth PKCE/device authorization support.
- Add remote history import.
- Define import-only, export-only, and bidirectional modes.
- Add sync cursors, remote event identities, tombstones, and conflict resolution.
- Add audit history and retry queues.

**Exit criteria:** At least one user-defined tracking API can import and safely synchronize watch events.

### Phase 9: Hardening and Release

- Complete CSP and Tauri capability restrictions.
- Add security tests for malicious templates and redirects.
- Add database backup and recovery UI.
- Add diagnostics with automatic secret redaction.
- Test Wayland, X11, suspend/resume, offline startup, and large libraries.
- Build PKGBUILD/AUR and AppImage artifacts.
- Add release CI and checksums/signing where applicable.

**Exit criteria:** PLATYPUS can be installed and updated as a reliable Linux desktop application.

## Testing Strategy

### Unit Tests

- Mapping expressions
- Template validation
- Capability derivation
- Normalized model validation
- Merge precedence and provenance
- Duplicate suggestions
- Progress computation
- Rate-limit and retry policies

### Integration Tests

- SQLite migrations and rollback
- Version 2 import
- Secret reference resolution
- Connector request pipeline using local mock servers
- Pagination and partial provider failure
- Search across multiple connections
- Connection removal without local data loss

### End-to-End Tests

- First launch
- Manual movie and series tracking
- Add and verify a source
- Search and import from multiple sources
- Link and unlink duplicate results
- Export and restore a backup
- Upgrade from an older database schema

### Required Project Checks

Use the project toolchain for validation:

```bash
vp install
vp check
vp test
vp build
```

Desktop build commands should be exposed through Vite+ compatible scripts or `vp exec` rather than invoking the package manager directly.

## Release Acceptance Criteria

The first general desktop release is complete when:

- It installs and starts on supported Arch Linux systems.
- It works without Chromium or a separately opened browser.
- It starts offline and exposes the existing local library.
- Users can add movies and series from configured public sources and track them locally.
- Users can create or import safe declarative source templates.
- At least two different API shapes can be configured without provider-specific application code.
- Search labels and isolates results by connection.
- Capability state and per-item completeness are visible.
- Removing a connection does not remove library or history data.
- Credentials do not appear in the database, logs, backups, or exported templates.
- Existing version 2 data can be migrated with a dry-run report and rollback safety.
- Database updates and multi-record synchronization use transactions.
- Automated tests cover migrations, connector validation, and core tracking behavior.

## Principal Risks

### Connector Complexity

APIs vary more than their JSON shapes suggest. Authentication, pagination, episode ordering, and write semantics may require additions to the declarative schema. Keep version 1 intentionally narrow and evolve it from real user-created templates.

### Mapping Language Safety

An overly weak mapping language will not normalize useful APIs; an overly powerful one becomes executable code. Select a deterministic, resource-limited expression model and test malicious or pathological inputs.

### Identity and Duplicate Handling

Incorrect automatic merges can corrupt history. Prefer false negatives and manual linking over speculative merges.

### Bidirectional Synchronization

Remote edits, deletions, clock differences, and repeated imports require event identities and explicit conflict policies. Do not add write synchronization before the event and audit models are ready.

### Licensing and Attribution

Users can connect APIs with different usage rules. Templates should carry attribution and cache-policy metadata, and the UI should make those obligations visible. PLATYPUS should not claim that a technically accessible API is legally unrestricted.

### Desktop Privilege Exposure

Remote descriptions, images, and imported templates are untrusted input inside a privileged desktop application. Maintain narrow Tauri capabilities and a strict separation between display content, connector configuration, secrets, and native commands.

## Immediate Next Actions

1. Exercise the GitHub release workflow with a version tag and verify both packages on clean Linux systems.
2. Complete native credential storage before enabling authenticated source execution.
3. Harden connector redirects, caching, pagination, rate limits, and malicious-template tests.
4. Add database recovery and redacted diagnostics workflows.
5. Finish remote tracking synchronization, conflict handling, and audit/retry behavior.
6. Test Wayland, X11, offline startup, suspend/resume, upgrades, and large libraries.

## Reference Documentation

- [Tauri 2 documentation](https://v2.tauri.app/)
- [Tauri SvelteKit frontend guide](https://v2.tauri.app/start/frontend/sveltekit/)
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/)
- [Tauri permissions](https://v2.tauri.app/security/permissions/)
- [Tauri Linux distribution](https://v2.tauri.app/distribute/)
- [Existing PLATYPUS V2 feature specification](./V2_FEATURES.md)

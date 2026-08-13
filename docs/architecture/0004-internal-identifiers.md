# ADR 0004: UUIDv7 internal identifiers

Status: Accepted for the first desktop release.

Canonical entities, events, collections, connections, and provider links use application-generated UUIDv7 strings. Remote identifiers remain strings on `ProviderLink` records and never become primary or foreign keys.

UUIDv7 gives offline-safe, provider-neutral identifiers with useful creation-time locality for SQLite indexes. IDs are generated in the trusted application layer and treated as opaque by the UI. Timestamps remain explicit fields; code must not derive domain timestamps from an ID.

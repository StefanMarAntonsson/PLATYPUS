# Desktop architecture decisions

These decisions freeze the Phase 0 vocabulary and boundaries for the first desktop release.

- Canonical media is provider-independent. A `MediaItem` is a movie or series; series own optional seasons and episodes.
- A Collection is a user-curated grouping of media. “Series” is not a second grouping feature; it is canonical media with a season/episode hierarchy. Version 2 `series` groups will be migrated without loss, using a collection or an explicit relationship after migration review.
- Library intent (`planned`, `watching`, `paused`, `dropped`, `completed`) remains separate from derived progress (`unstarted`, `in_progress`, `caught_up`, `finished`).
- Source templates describe untrusted, read-only catalog operations in version 1. Connections hold local configuration and secret references and are deliberately not portable template data.

The executable contracts live in [`src/lib/domain/contracts.ts`](../../src/lib/domain/contracts.ts), [`src/lib/connectors/contracts.ts`](../../src/lib/connectors/contracts.ts), and [`src/lib/connectors/source-template.schema.json`](../../src/lib/connectors/source-template.schema.json).

The v1 template schema is intentionally closed except for top-level `x-*` extension metadata. A later incompatible capability requires a new `schemaVersion`; readers may retain but need not interpret extension metadata.

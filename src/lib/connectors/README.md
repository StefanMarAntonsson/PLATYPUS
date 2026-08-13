# Source template version 1

A `.platypus-source.json` document describes requests and response mappings, never a user's connection or secret values. The authoritative format is `source-template.schema.json`; `contracts.ts` mirrors the validated in-memory shape.

The app creates these templates through its custom-source form or imports them from a source bundle. PLATYPUS does not ship with provider templates configured. Portable `platypus-sources.json` bundles contain any number of templates plus their non-secret connection settings. Bundles deliberately omit local connection IDs, credential references, capability results, and tracking audit history so they can be shared safely.

Only import source bundles from people you trust. A bundle controls which approved hosts receive requests, along with request paths, query values, bodies, and headers. The engine validates templates, requires HTTPS except for loopback development, blocks redirects, limits response sizes and pagination, and restricts artwork to declared hosts, but importing a bundle still authorizes the network behavior it declares.

Version 1 supports REST JSON over GET/POST and GraphQL over POST, header/query API keys, bearer/basic authentication references, page/cursor pagination, bounded retry policy, response JSON Schema, and path-only response mapping. Operations are independently optional.

Template strings interpolate only `${input.*}`, `${connection.*}`, `${secret.*}`, and `${page.*}` values. Mapping paths use the safe JSON path subset recorded in ADR 0003. HTTPS is required except for loopback HTTP, whose use still requires explicit activation approval. `allowedHosts` controls API requests; `assetHosts` does not grant credential access.

Unknown behavior is rejected. Top-level `x-*` metadata is the sole forward-compatible extension point and cannot change connector execution.

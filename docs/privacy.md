# Privacy and network activity

PLATYPUS is a local-first desktop application. Library entries, watch progress, settings, and source connections are stored on the user's device. PLATYPUS does not include telemetry, advertising, analytics, or a PLATYPUS account service.

PLATYPUS ships without API providers or source connections. Network requests to a media provider occur only after the user creates or imports a source connection and then searches, tests, or refreshes data through that connection.

## Information visible to a configured provider

A provider can receive:

- the user's public IP address and ordinary connection metadata;
- search text, provider item IDs, and pagination values required for the selected operation;
- headers, connection settings, or authentication values declared by the source configuration; and
- requests for artwork hosted by that provider or a declared artwork host.

PLATYPUS does not add a stable user, device, installation, or local connection identifier to source requests. Providers process requests under their own terms and privacy policies.

## Portable files

Library backups contain local library and tracking data. Source bundles contain source templates and non-secret connection settings. Source exports deliberately omit local connection IDs, credential references, test results, and tracking audit history. Users should still inspect and share exported files with the same care as other personal configuration data.

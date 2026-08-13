# ADR 0003: Deterministic path-only mapping expressions

Status: Accepted for source template version 1.

Version 1 mapping uses a documented, resource-limited JSON path subset rooted at `$`: object member access, array indices, and wildcard array traversal. It has no filters, recursive descent, functions, arithmetic, mutation, network access, or host-language evaluation. Template interpolation separately permits named values from `input`, `connection`, `secret`, and `page` namespaces.

Mappings select values only. The connector applies built-in target-field coercion and then validates normalized output. Unsupported expressions fail template validation; missing optional paths produce missing fields, while missing required normalized fields fail that result. Limits apply to expression length, response size, traversal depth, and result count.

This deliberately favors safety and predictable diagnostics. Any future transformation syntax requires a versioned schema decision rather than embedding JavaScript or a general expression engine.

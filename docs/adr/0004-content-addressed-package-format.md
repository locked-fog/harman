# ADR-0004: Content-addressed package format and Store

Status: accepted (2026-08-19)

Harman packages use a gzip-compressed ustar archive whose entries are rooted at
`package/`. The archive must contain `package.json`; its `name` and `version`
must match repository metadata. The verified archive SHA-256 is the Store object
identity. Every imported object also carries `.harman-object.json` with sorted
per-file SHA-256 values.

The importer accepts only regular files and directories, verifies tar header
checksums and bounded compressed/uncompressed sizes, and rejects absolute paths,
traversal, backslashes, duplicate paths, links, devices, and unknown entry
types. It extracts to a private staging directory, makes the tree read-only,
and atomically publishes it. Repository state refers only to fully published
objects. An interrupted import may leave an unreferenced object, never a visible
half-installed package; later reference-aware garbage collection may reclaim it.

This deliberately excludes arbitrary npm archive features and install scripts.
Recipe/CI builders normalize upstream content into this format. Normal user
installation performs no npm/pnpm resolution or lifecycle execution.

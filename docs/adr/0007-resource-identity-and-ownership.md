# ADR-0007: Resource identity, scanning, and ownership

Status: accepted (2026-08-19)

Resources use stable `<type>/<name>` URIs and retain canonical absolute
locations, scope, source, availability, fingerprint, ownership, and Profile
bindings. Package, external, and managed ownership are distinct states.

Scanners are read-only and idempotent. They enumerate only known roots, never
follow symbolic links, and mark a previously scanned missing object unavailable
instead of deleting it. Skills, Prompts, and AGENTS.md use content fingerprints.
MCP configuration uses a metadata fingerprint so scanning cannot ingest secret
values into state or audit. Name/location collisions are surfaced as conflicts
instead of silently replacing an existing identity.

External objects remain user-owned. Register, bind, detach, enable, disable,
Profile deletion, and missing-path handling never modify their bytes. `adopt` is
the only transition to managed ownership: it first reports source, target, and
rollback, requires explicit confirmation, copies without links into the managed
root, and commits ownership transactionally. If publication fails, Harman
removes the copy and retains the external record and source.

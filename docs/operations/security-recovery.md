# Security, backup, migration, and incident recovery

Back up the complete `HARMAN_HOME` while no daemon or Profile mutation is in
progress. The authoritative state is `state.json`; `transaction-intent.json`,
`state.lock`, and `recovery/` support crash diagnosis. Store objects are
immutable and reproducible from trusted artifacts, but retaining them enables
strict offline Profile restore.

On restart, Harman recovers a durable transaction journal as committed only if
the published state hash and revision match its proposal. Otherwise it preserves
the intent as aborted. Dead writer locks and dead Profile run-owner PIDs are
reclaimed with audit events. ENOSPC, SIGKILL, network truncation, invalid JSON,
bad hashes, bad signatures, replay, and stale Web revisions leave the prior
authoritative state usable.

Use `state migrate` for supported schema upgrades. A future schema is refused
without mutation. Export Profiles before a program downgrade; do not edit schema
versions manually. `profile restore --mode strict` requires the recorded Runtime
hash, while `follow-latest` explicitly selects the current latest channel. If its
compatibility diagnostics indicate a breaking upstream, pin the Profile to a
known-good exact version.

For a repository incident: disable the source, preserve cache and audit state,
revoke the affected key, raise or rotate the threshold, publish a higher
sequence, sync, and review the impact before upgrades. Store garbage collection
requires a preview and confirmation and retains every Package and Runtime hash.

Secrets belong in DSH Credentials or explicit environment references. Profile
exports reject literal secret-looking fields, daemon/API responses never expose
the bearer token, and audit details redact token/password/secret/API-key names.
External Resources are never deleted or overwritten; `adopt` is the sole
external-to-managed transition.

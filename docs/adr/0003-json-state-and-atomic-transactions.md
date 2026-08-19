# ADR 0003: versioned JSON state with durable single-file transactions

- Status: accepted for M1
- Decision scope: authoritative metadata and mutation protocol

## Context

Harman needs deterministic, inspectable state before Repository, Store, and
Profile features exist. Adding a native database dependency at this stage would
expand package/bootstrap trust without removing the need for atomic filesystem
publication of manifests and Store objects.

## Decision

Use a strict, versioned JSON state document as the M1 authority. One exclusive
lock directory serializes writers. A transaction reads and validates the current
revision, clones it, applies one domain mutation, validates all graph and
ownership invariants, appends a redacted audit event, and publishes with:

1. a fsynced intent journal containing base/proposed revision and hashes;
2. a same-directory temporary state file, fsynced before publication;
3. atomic rename over the state file;
4. directory fsync;
5. journal removal and a second directory fsync.

On open, a journal whose proposed hash equals current state is a committed
transaction interrupted during cleanup and is removed. Any other journal is an
aborted pre-publication intent and is preserved as a timestamped recovery record
before normal operation. Unknown future schema versions are refused. Explicit
migration functions are the only accepted version transition.

Audit data is part of the same state transaction, preventing a successful
mutation without an event. Sensitive key names are recursively redacted before
persistence. Filesystem package/Profile materialization will use its own staged
transaction participant in later milestones; this ADR does not claim that the
single JSON rename alone makes multi-file installation atomic.

## Consequences

The design has no runtime dependency, is easy to recover and export, and is
adequate for the expected control-plane metadata scale. Writes are serialized
and the full state is rewritten. Performance tests in M7 will define the
migration threshold; a future SQLite backend must preserve schema semantics,
revision preconditions, audit coupling, and crash tests.

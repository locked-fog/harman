# ADR-0010: Per-repository Ed25519 trust roots

Status: accepted (2026-08-19)

Each Repository has an independent policy: `trusted-local`, `hash-only`, or
`signed`. Signed sources store only Ed25519 public keys, their SHA-256 SPKI key
IDs, a distinct-signature threshold, and an append-only revocation set. Private
keys are never accepted by the manager or written to state/audit.

The index signature covers canonical JSON excluding `signatures`. Every artifact
also signs the canonical tuple `{schemaVersion,name,version,sha256}`. A signed
source must meet its threshold at synchronization and again whenever cached
metadata is searched or solved, so a newly revoked key invalidates old cache
immediately. Artifact verification precedes download; SHA-256 then verifies the
bytes and Store identity.

Sequence rollback and same-sequence/different-content mirror responses fail.
Multi-source selection is descending priority then stable repository ID, with
version solving deterministic inside that order. Disabling a source is explicit
distrust: it is excluded even if its cache and signatures remain valid. Rotation
adds and deploys the new key/signatures before revoking the old key. Thresholds
cannot exceed the current active key count.

# ADR-0009: Portable Profile export and restore

Status: accepted (2026-08-19)

A Profile export is a versioned directory bundle containing a canonical
`profile-export.json`, verified immutable Package objects, and copies of managed
Resources. External Resources remain references with canonical location and
fingerprint. Secret values are forbidden by Profile validation; only explicit
`secretRef` objects enter the declaration and export.

The manifest includes both the declared Runtime policy and last resolved
Runtime. Strict restore requires that exact compatible Runtime identity and
records an exact selection. Follow-latest restores the original channel policy.
The report always records the chosen mode. Equivalence compares Package
identity/content hashes, Resource identity/fingerprints/ownership, configuration,
and Cordis Patch; machine-specific Store and managed paths are not identities.

Restore verifies the canonical manifest hash, every Store manifest and file
hash, managed Resource fingerprint, external Resource availability/fingerprint,
Runtime compatibility, and schema version before exposing the Profile. Objects
may be placed in Store before state publication but remain unreferenced and
invisible on failure. Added state inputs and managed copies are rolled back if
Profile creation fails. Forward schemas and changed external content fail closed.

# ADR 0001: stock DSH with an external Harman control plane

- Status: accepted; M0 evidence recorded under `evidence/M0/`
- Decision scope: runtime ownership and compatibility

## Context

Harman manages selection, provenance, transactions, Resources, and isolated
Profiles. Reimplementing or embedding that control plane in DSH would couple
Harman to upstream internals and violate the project boundary.

## Decision

Use an unmodified DSH release by default. Harman resolves the selected
Runtime, records its compatibility diagnostics, creates a distinct DSH_HOME
for each Profile, and materializes the
manifest, Cordis Patch, and a read-only package module view that stock DSH can
consume. Generated DSH state is disposable and excluded from the authoritative
Profile lock.

Compatibility is an executable diagnostic contract. A new latest is recorded
even when the contract reports a failure; the failure remains visible and a
Profile can be pinned to a known-good exact version. Prefer a versioned
external adapter, then a normal bridge plugin. A Runtime patch is the last
resort and requires a separate ADR with fixed upstream paths, evidence that
public boundaries are insufficient, ABI impact, replay tests, upstreamability,
and removal conditions. Harman Core never enters such a patch.

## Consequences

Profiles can follow latest or explicitly pin an exact version while recording
the actually executed artifact. Upstream changes remain observable through
the diagnostics and audit record, while the OS-enforced read-only
materialization detail remains an M4 acceptance item.

## Validation required

The fixed DSH baseline proves Profile loading, Cordis/ctx services,
Agent/Tool/Skill/MCP/Session behavior, independent DSH_HOME operation, generated
state boundaries, and public Web seams. M4 must additionally prove Profile-local
module loading from a read-only view and predictable behavior when Harman is
inactive.

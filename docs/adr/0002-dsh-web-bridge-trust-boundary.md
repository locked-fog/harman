# ADR 0002: DSH Web bridge and transaction trust boundary

- Status: accepted; M0 extension-point evidence recorded under `evidence/M0/`
- Decision scope: Web integration and write authority

## Context

DSH Web management is a required product surface, but duplicating package,
ownership, solver, or transaction behavior in browser code would create an
untrusted second implementation and inconsistent outcomes.

## Decision

Deliver a normal `@harman/dsh-bridge` Host/Client bundle. The Host side exposes
a narrow authenticated local transport to the Harman daemon/Application. The
Client side registers a discoverable DSH Settings experience and renders query,
impact-plan, transaction-progress, audit, and diagnostic results.

Every mutation follows `query current revision -> request impact plan -> user
confirmation -> submit plan token with revision precondition -> stream result ->
refresh authoritative state`. Core revalidates authorization and preconditions.
The browser never reads or writes Profile/Store paths, invokes npm/pnpm, solves
dependencies, or declares a transaction successful on its own.

If the daemon disconnects, state becomes stale, authorization expires, or a
transaction fails, mutation controls fail closed. Cached information may remain
visible only when clearly marked read-only and stale. CLI, Automation API, and
Web call the same Application operations.

## Consequences

This adds a daemon/API availability dependency for Web writes while preserving
fully functional headless CLI/API behavior. UI acceptance must exercise real
transactions, rollback/failure, accessibility, responsive layout, refresh, and
concurrency; static cards and mocks cannot satisfy it.

## Validation required

M0 located and tested the stock Settings slot, client plugin, typed Remote, and
transport seams. M7 must validate the Harman bridge against their real browser
lifecycle. If a required detail proves missing, record the smallest external
adapter before considering an upstreamable Runtime patch.

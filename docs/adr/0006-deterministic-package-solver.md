# ADR-0006: Deterministic package solving

Status: accepted (2026-08-19)

The solver consumes only synchronized, validated Harman repository indexes. It
orders repositories by descending priority then stable ID, and versions by
semantic version. Backtracking resolves transitive constraints while checking
DSH range, platform, architecture, and explicit holds. The result records each
selection, reason, repository, and dependency edges so installation and upgrade
plans are explainable and repeatable.

Multiple versions may coexist in the Store and state model, but a single solve
chooses one version per canonical package name. Unsatisfied constraints and
cycles fail with structured diagnostics. Explicit packages and dependencies are
tracked separately; a referenced old version is retained rather than deleted.
Downgrades require an explicit version request or hold. Repository sequence
rollback is rejected independently of package version choice.

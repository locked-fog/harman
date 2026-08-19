# ADR-0005: Fail-closed recipe sandbox

Status: accepted (2026-08-19)

Recipes are versioned declarative JSON. Every upstream archive is URL-addressed
and SHA-256 pinned; commands are argv arrays, never shell strings. Local builds
require Linux `bubblewrap`. If it is absent or cannot create namespaces, Harman
refuses the build rather than silently running unsandboxed.

The sandbox uses new user, PID, IPC, UTS, cgroup, and network namespaces by
default. `/usr` is read-only, `/tmp` is ephemeral, the source tree is the only
writable bind, the environment is cleared, and only deterministic `PATH`,
`HOME`, and `SOURCE_DATE_EPOCH` values are supplied. Network access is an
explicit recipe capability. Output must remain below the build root and is fed
through the same hash, archive, identity, and immutable Store checks as a
prebuilt package.

Recipes currently accept pinned npm-style tarballs because that is the common
normalized upstream carrier. GitHub release/source inputs are represented by
their pinned tarball URL. CI must use the same builder and publish the resulting
archive plus provenance, manifest, SBOM, compatibility report, and signature.

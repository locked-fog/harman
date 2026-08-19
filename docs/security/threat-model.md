# Harman threat model

## Assets and trust boundaries

Protected assets are Profile declarations and private DSH state, immutable
Store objects, repository/trust metadata, external Resources, credentials and
secret references, audit integrity, and the stock DSH installation. Boundaries
exist between repository/index, recipe builder, artifact importer, Store,
daemon/Core API, CLI/Web clients, DSH/plugin runtime, external Resource roots,
and exported Profile bundles.

Repository metadata, artifacts, recipes, package build scripts, plugins,
external Resource contents, imported bundles, browser requests, and network
responses are untrusted. A configured trust root authenticates identity but
does not make package code safe at runtime.

## Threats and required controls

| Threat | Required prevention / detection | Acceptance evidence |
| --- | --- | --- |
| Index/artifact substitution | signed versioned metadata, pinned hashes, atomic cache update, explicit source identity | bad signature/hash and mirror mismatch tests |
| Replay/downgrade/freeze | monotonic metadata/version policy, expiry, revocation state, deliberate downgrade override with audit | replay, stale metadata, and downgrade tests |
| Dependency confusion | repository-scoped identity, deterministic source priority, locked dependency provenance | conflicting source fixture |
| Archive traversal / link escape | reject absolute, parent, special-device, hardlink and escaping symlink entries before extraction | hostile archive corpus |
| Mutable Store | stage then verify; atomic content-addressed commit; no in-place updates; OS-enforced read-only Profile view | mutation and read-only mount tests |
| Malicious build script | unprivileged isolated workspace, minimal environment, bounded filesystem, network off by default, resource/time limits | escape/network/environment probes |
| Plugin runtime abuse | do not claim plugin sandboxing unless DSH enforces it; isolate each Profile state and document runtime trust | cross-Profile probes and support matrix |
| Resource scanner escape | allowlisted roots, canonical-path checks, bounded symlink handling, no secret-value parsing | symlink and permission fixtures |
| external deletion/overwrite | ownership is stored, operations are relation-only, managed roots require manifest match | byte-for-byte lifecycle tests |
| Confused `adopt` | preview exact source/destination/hash, explicit confirmation, atomic copy, rollback record | interruption and conflict tests |
| Secret disclosure | store/export references only, redact logs and API responses, schema-classified sensitive fields | export/log/browser tests |
| Web confused deputy / CSRF | local authenticated IPC/API, origin and request validation, scoped session, Core authorization | unauthorized request tests |
| Stale Web mutation | revision/ETag precondition and impact-plan token; reject stale plans fail closed | concurrent browser/API tests |
| Transaction interruption | locking, journal/database transaction, durable staged writes, atomic replace, startup recovery | kill and disk-full injection |
| Schema attack | versioned strict schemas, bounds, reject unknown future versions, transactional migration | fuzz/migration tests |
| Audit tampering | append-only ordered events with actor, intent, impact, result, and redaction | sequence/integrity assertions |
| Trust-key compromise | offline root policy, delegated signing where applicable, rotation and revocation | rotation/revocation E2E |

## Safety invariants

- No normal package install or DSH run executes npm/pnpm dependency resolution.
- No operation changes an external Resource except the explicit `adopt` copy or
  migration authorized after an impact preview.
- No unverified artifact becomes visible in the Store or a Profile.
- No Profile shares writable DSH state with another Profile.
- No browser action directly writes Store/Profile files or executes build tools.
- No failure is reported as rolled back until visible state and references have
  been verified against the pre-transaction snapshot.
- No remote system mutation occurs without a recorded Snapper recovery point.

Residual risks, including stock DSH/plugin execution authority, will be updated
from the fixed-version M0 research rather than guessed here.

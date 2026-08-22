# DSH upstream synchronization

Query the official npm registry, record the resolved DSH version, integrity,
tarball SHA-256, and source metadata when available. The compatibility
contract remains an important diagnostic, but it is no longer a promotion
gate: a candidate whose contract fails is still recorded and can become
`latest`, while artifact integrity and repository trust remain blocking.
`harman -Sy` reports a candidate; `harman -Syu` or `harman runtime sync`
imports it and records the contract result. `harman init` and
`harman runtime detect` cover globally installed DSH packages without manual
hash/version entry.

## Version-family rule

`latest` is a channel policy, not a request to independently install the
latest tag of every DSH support package. The Bridge build resolves
`@deepseek-ai/dsh` first and follows its dependency/version family for Typert,
Session, protocol, and client packages. This is required because the
individual npm `latest` tags can lag the DSH CLI release.

For 1.0.0-pre-2, the live registry resolved:

```text
@deepseek-ai/dsh             0.1.1-rc.1
@deepseek-ai/dsh-typert-*    0.1.1-rc.1
@deepseek-ai/dsh-session     0.1.1-rc.1
```

The exact tarball URL, npm integrity, downloaded integrity, SHA-256, and all
support requests are recorded in the release `build-manifest.json`. A
candidate that cannot produce one protocol-native Host/Remote artifact fails
closed; it is not repaired by silently mixing package `latest` tags.

## Derived DSH_HOME state

The stock DSH `0.1.1-rc.1` profile boot establishes an upstream lifecycle
boundary that Harman must preserve:

- DSH owns the derived `profiles/<profile>/cordis.yml` root. The stock boot
  writes an empty root configuration on profile preparation and composes the
  effective tree from bundle patches, profile `cordis.patch.yml`, home patches,
  and overlays. The root file is a generated view, not the durable user input.
- Harman owns the profile input `profiles/harman/cordis.patch.yml`, its package
  view, `harman.lock.json`, and `.harman-managed.json`. Harman does not put the
  DSH-generated root file in its lock or try to merge it as user configuration.
- DSH owns its cache and other private state under DSH_HOME. Harman's atomic
  rematerialization replaces only the paths recorded as Harman-managed and
  preserves unrelated private state. A cache may be rebuilt by DSH, so it is
  never treated as authoritative release input.
- After rematerialization, DSH startup is expected to recreate its derived
  `cordis.yml`. A missing generated root immediately after Harman materializes
  is therefore an expected intermediate state, not a reason to copy an old
  root back into the managed view.

The regression test named `DSH-derived cordis root is rebuilt while private
cache survives Harman rematerialization` records this ownership split locally.
The release evidence records the exact upstream package used to observe the
contract; a future DSH change that moves or persists these paths must update
the contract and its test before `latest` can advance.

## Compatibility diagnostics

The blocking contract covers Profile loading, distinct DSH_HOME writes,
read-only Package views, no package-manager fallback, Cordis and `ctx.*`
lifecycle, Agent/LLM, Tool/Skill/MCP, Session, Settings/Credentials, the normal
Host/Client bridge, strict Remote transport, and inactive ambient DSH behavior.

A failed candidate is recorded as `breaking` and remains visible in Runtime
diagnostics, but it can become latest and launch. Classify the failure as an
upstream defect, environment drift, or changed public boundary. Users can
pin a known-good exact version while the issue is investigated. Prefer a
versioned external adapter, then a Bridge change. A Runtime patch is a last
resort and requires an ADR with exact upstream paths, ABI impact, replay
test, removal condition, and an upstreamable change. Harman Core never moves
into such a patch.

Pinned Profiles remain on their exact record while latest Profiles advance.
Each run records the resolved version, source, hash, and timestamp; it does
not rewrite the declared channel policy.

## Embedding the Bridge in an upstream DSH checkout

The Bridge is an ordinary Host/Client package. When it is embedded in an
upstream DSH source checkout for a real Web run, the root project references
must include both sides of the package:

- `tsconfig.host.json` references `packages/harman/dsh-bridge/tsconfig.host.json`;
- `tsconfig.client.json` references `packages/harman/dsh-bridge/tsconfig.client.json`.

The client reference is required for the generated client declaration graph;
without it, the Web build can resolve the source package but fail while
following `@harman/dsh-bridge/client` declarations. The package publication
also includes `lib/typert.host.js` and its declaration because Typert host
analysis consumes that entry during normal plugin loading. These are upstream
checkout integration references, not a DSH Runtime fork or a replacement for
the public Host/Client extension points.

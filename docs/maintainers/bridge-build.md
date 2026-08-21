# Official DSH npm Bridge build

`@harman/dsh-bridge` is built from the published DSH ecosystem packages. The
repository does not depend on an upstream DSH checkout being present beside
the repository, and it does not install downloaded package lifecycle scripts.

The DSH npm manifest declares MIT. Harman uses MIT in the root repository and
the published Bridge package; the release build copies the root `LICENSE` into
the Bridge tgz and sets its `license` field.

## Release-family resolution

The build follows `@deepseek-ai/dsh@latest` by default. It first resolves the
DSH CLI metadata, then resolves `@deepseek-ai/dsh-typert-generator` and the
runtime support packages from that same DSH dependency/version family. It does
not independently use the individual packages' `latest` tags: those tags can
lag the DSH CLI and produce a generator/protocol mismatch.

The Typert generator defaults to `match-dsh`:

```bash
HARMAN_NPM_CACHE=/tmp/harman-npm-cache \
  npm run build:bridge -- \
    --package-version 1.0.0-pre-2 \
    --dsh-version latest \
    --generator-version match-dsh
```

For a reproducible release, preserve the generated
`evidence/releases/<version>/build-manifest.json`. It records the requested
channel, resolved versions, dependency ranges used for support packages, the
official DSH tarball URL, npm integrity, downloaded integrity, SHA-256, and the
Bridge artifact SHA-256. At the time of the 1.0.0-pre-2 preparation,
`latest` resolved to `@deepseek-ai/dsh@0.1.1-rc.1`; the Typert generator,
protocol, and Session were resolved to the same release family.

## Compatibility adapters

The long-term boundary for the two historical type mismatches is now explicit:

- `packages/dsh-bridge/src/types.ts` owns the recursive Bridge `JsonValue`
  root. It is checked for bidirectional assignability against the official
  `@deepseek-ai/dsh-session` `JsonValue`, so a Session contract drift becomes a
  TypeScript build failure rather than an implicit declaration mismatch.
- `packages/dsh-bridge/src/compat/typert-protocol.d.ts` is a checked-in,
  static-analysis contract for the external official Typert workspace. Runtime
  imports still resolve to the published
  `@deepseek-ai/dsh-typert-protocol`; the file is not a runtime facade and is
  not included in the packed Bridge artifact.
- Generated declarations are required to be protocol-native. The build fails
  closed if the retired `@deepseek-ai/dsh-type-meta` or `TypeRTRemote` contract
  appears. `@deepseek-ai/dsh-type-meta` is not required for the current DSH
  release family and is not silently synthesized during the build.

The resulting package must contain `lib/typert.host.js`, the Host/Remote
declarations, the client bundle, and no `dsh-type-meta` or `TypeRTRemote`
references. The manifest's `build.compatibility` object is the machine-readable
record of this boundary.

## Build steps

The build performs these bounded steps:

1. Query and `npm pack` the official `@deepseek-ai/dsh` package, with scripts
   disabled, and verify the registry SHA-512 integrity.
2. Pack the release-family Typert generator, protocol, Cordis, Session, client
   Web packages, and fixed build-time dependencies into a temporary
   `node_modules` tree. No repository `node_modules` or lockfile is created.
3. Create a temporary Host/Client TypeScript workspace, run the official
   `@deepseek-ai/dsh-typert-generator`, emit Host and Remote contracts, and run
   TypeScript declaration checks.
4. Build the Host ESM entry and Client browser bundle. The Client output is
   wrapped in DSH's `window.__ModuleLoader__.load()` contract and keeps React as
   a DSH-provided external dependency.
5. Pack only the declared Bridge files and emit a repository `index.json`.

## Output and verification

The default output is:

```text
evidence/releases/<version>/
├── build-manifest.json
├── harman-dsh-bridge-<version>.tgz
└── index.json
```

The artifact can be inspected without installation:

```bash
tar -tzf evidence/releases/1.0.0-pre-2/harman-dsh-bridge-1.0.0-pre-2.tgz
```

The build proves package generation and static/runtime bundle shape. It does
not replace the separate M7 real-browser acceptance, independent accessibility
testing, or the upgrade/uninstall/community/non-Harman regression matrix.

# Official DSH npm Bridge build

`@harman/dsh-bridge` is built from the published DSH ecosystem packages. The
repository no longer assumes that an upstream DSH monorepo checkout exists next
to this repository.

## Reproducible release build

Use an exact DSH version for a release candidate:

```bash
HARMAN_NPM_CACHE=/tmp/harman-npm-cache \
  npm run build:bridge -- --package-version 1.0.0-pre-1 --dsh-version 0.1.0-rc.7
```

The default DSH request is `latest`; a release build should pass an exact
version and retain the generated `evidence/releases/<version>/build-manifest.json`.
The manifest records the requested channel, the resolved official package
versions, the DSH registry tarball URL, npm integrity, downloaded integrity,
SHA-256, and the Bridge artifact SHA-256.

The build performs these bounded steps:

1. Query and `npm pack` the official `@deepseek-ai/dsh` package, with scripts
   disabled, and verify the registry SHA-512 integrity.
2. Pack the official Typert generator, protocol, Cordis, Session, client Web
   packages, React, TypeScript, esbuild, and their small build-time dependencies
   into a temporary `node_modules` tree. No repository `node_modules` or lockfile
   is created, and no lifecycle script from a downloaded package is run.
3. Create a temporary Host/Client TypeScript workspace, run the official
   `@deepseek-ai/dsh-typert-generator`, emit Host and Remote contracts, and run
   TypeScript declaration checks.
4. Build the Host ESM entry and the Client browser bundle. The Client output is
   wrapped in DSH's `window.__ModuleLoader__.load()` contract and keeps React as
   a DSH-provided external dependency.
5. Pack only the declared Bridge files and emit a repository `index.json`.

The published `@deepseek-ai/dsh-type-meta` peer referenced by the current
Typert generator is not available from npm. The build therefore creates a
temporary static-analysis facade and normalizes generated declarations back to
the published `@deepseek-ai/dsh-typert-protocol` API. The facade is never copied
into the Bridge artifact. This compatibility boundary remains a release risk
until the upstream package contract is published or the generator/protocol
versions converge.

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
tar -tzf evidence/releases/1.0.0-pre-1/harman-dsh-bridge-1.0.0-pre-1.tgz
```

The build proves package generation and static/runtime bundle shape. It does
not replace the separate M7 real-browser acceptance, latest compatibility
follow-up, or standalone accessibility testing.

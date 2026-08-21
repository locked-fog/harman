# Recipe and Repository maintainer guide

Repository index v1 is monotonic (`sequence`), hash-addressed, optionally
Ed25519-signed, and may carry Package and official DSH Runtime channels.
Artifact URLs resolve relative to the index URL. A signed source requires the
configured threshold of active keys on both index and artifacts; revoked keys,
same-sequence content changes, and lower sequences fail closed.

Recipe v1 accepts immutable `npm-tgz`, `github-release`, and `git-archive`
sources with SHA-256. Source is extracted at `/work`; output is written below
the separate `/output` mount. The environment contains only a fixed PATH, HOME,
and `SOURCE_DATE_EPOCH`; network is absent unless the reviewed recipe opts in.
Commands are argv arrays and never pass through a shell.

```bash
harman-repo build recipes/example.json dist/example
harman-repo sign-artifact NAME VERSION SHA256 private.pem artifact.sig.json
harman-repo sign-index index.unsigned.json private.pem index.signed.json
```

CI builds each recipe twice and rejects byte differences when the ordinary-user
runner exposes the required bubblewrap namespaces. The public Hosted workflow
does not use `sudo` or install a privileged isolation runtime; it records a
visible deferral when that capability is absent. The full isolation contract is
run with `HARMAN_REQUIRE_SANDBOX=1` on the authorized `codex-test` workstation.
A successful build emits the package tarball, provenance containing
source/recipe/artifact hashes, and an SPDX 2.3 SBOM. Reviewers must also verify
license, DSH compatibility, runtime/peer/optional dependency collection, file
inclusion, lifecycle-script necessity, and declared Package-provided Resources.
Private keys remain outside the repository and CI artifact.

The checked-in `icelily-dsh-gitbash-preset` recipe demonstrates a real public
npm source, a disabled-network deterministic repack, and a standard Store
artifact. Publishing index and release assets to a personal GitHub repository
is a release operation requiring separate authorization.

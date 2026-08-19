# Repository maintenance and trust

```text
harman repo add personal https://example.invalid/harman/index.json 20
harman repo key-add personal ./repository-public.pem
harman repo policy personal signed
harman repo threshold personal 1
harman -Sy
harman repo priority personal 30
harman repo disable personal
harman repo enable personal
harman repo key-revoke personal <key-id>
harman repo remove personal
```

For key rotation, add the new public key, publish an index and artifact records
signed by both keys, synchronize, then revoke the old key. Revocation is checked
against cached indexes too. Keep private keys offline or in a protected CI
secret; Harman state contains public keys only.

Repository CI uses `harman-repo build RECIPE OUTPUT_DIR` to run the recipe twice
in isolated `bubblewrap`, require byte identity, and emit the package artifact,
provenance, and SPDX 2.3 SBOM. Sign artifacts and the final index separately:

```text
harman-repo sign-artifact NAME VERSION SHA256 private.pem artifact.sig.json
harman-repo sign-index index.unsigned.json private.pem index.json
```

Increment `sequence` for every content change. Reusing a sequence with different
content or lowering it is rejected. Artifact URLs should be immutable release
assets; their SHA-256 and Ed25519 signature must match the signed index. GitHub
publication, secrets, tags, and releases remain an explicit release operation,
not an effect of local testing.

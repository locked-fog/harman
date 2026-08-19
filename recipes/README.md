# First-party recipe directory

Store reviewed recipe-v1 JSON files here. Each source URL must identify an
immutable upstream archive and include its SHA-256. CI invokes
`harman-repo build` and publishes only artifacts that build twice byte-for-byte,
pass the Store/DSH compatibility tests, and have provenance and an SPDX SBOM.

Private signing keys never belong in this directory or repository.

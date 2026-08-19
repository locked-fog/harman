# First-party recipe directory

Store reviewed recipe-v1 JSON files here. Each source URL must identify an
immutable upstream archive and include its SHA-256. CI invokes
`harman-repo build` and publishes only artifacts that build twice byte-for-byte,
pass the Store/DSH compatibility tests, and have provenance and an SPDX SBOM.

Private signing keys never belong in this directory or repository.

Build commands run with the extracted, writable source at `/work` and a
separate writable artifact directory at `/output`. `outputArtifact` is a safe
relative path below `/output`; legacy recipes that place the same relative path
under `/work` remain readable. Network is disabled unless a reviewed recipe
opts in explicitly.

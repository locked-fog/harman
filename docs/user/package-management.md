# Package and recipe management

Set `HARMAN_HOME` or pass `--home PATH`. Commands also accept `--json`; changes
that remove objects require `--yes`, and supported operations accept
`--dry-run` for impact-only output.

```text
harman repo add main file:///path/to/index.json 10
harman repo list
harman -Sy
harman -Ss browser
harman --dry-run -S plugin-name
harman -S plugin-name
harman -Qi plugin-name
harman --dry-run -Syu
harman -Syu
harman --dry-run -R plugin-name
harman --yes -R plugin-name
harman recipe build ./recipe.json
```

Repository indexes are cached atomically and refuse sequence rollback. Package
downloads must match their declared SHA-256 and package identity before becoming
visible. Ordinary installation never runs npm, pnpm, or package lifecycle
scripts. `recipe build` is the explicit fallback for an absent prebuilt result;
it refuses to run if `bubblewrap` isolation is unavailable.

Recipe v1 is specified by `schemas/recipe-v1.schema.json`. Commands are argv
arrays, sources are immutable tarball URLs plus SHA-256, networking defaults to
off, and the output must be a valid Harman package archive inside the build
directory. Build logs report argv, exit status, signal, stdout, and stderr but
the sandbox receives no caller environment or secrets.

Repository maintainers increment `sequence` monotonically, use RFC 3339
`generatedAt`, publish immutable artifacts, and retain referenced versions. CI
should run the isolated recipe builder twice, compare artifact hashes, generate
an SPDX or CycloneDX SBOM, run the DSH compatibility contract, sign the index
and artifacts, and publish all evidence together. Signature enforcement is a
later milestone and unsigned sources must not be presented as signed.

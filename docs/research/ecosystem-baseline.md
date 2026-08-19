# DSH ecosystem sample baseline

On 2026-08-19 npm returned active public packages for `deepseek harness plugin`
and `dsh plugin`. Eight fixed releases were inspected on `codex-test`; no
community lifecycle or plugin code was executed.

| Package | Version | Coverage reason |
| --- | --- | --- |
| `dsh-desktop-shortcut` | 0.2.7 | prebuilt JS, Web client, images, peer Cordis |
| `@dsh-plugin/dsh-auxiliary` | 0.4.3 | TS/prepack, large peer set, Host/client, maps/types |
| `dsh-context` | 0.14.0 | custom build, client, Playwright runtime dependency |
| `dsh-wechat-mp` | 0.3.0 | prepare/build, assets, Typert remote, deps/peers |
| `dsh-cloudflare-browser-run` | 0.1.3 | compact TS external-service tool |
| `dsh-multimodal-bridge` | 0.1.2 | prepare lifecycle and several Host modules |
| `@dexthemes/deepseek-harness-plugin` | 0.6.4 | client-heavy package, runtime dep, React peer |
| `@icelily/dsh-gitbash-preset` | 0.1.2 | preset resources and absent repository metadata |

All declare `dsh.bundle.patch`; five also declare `dsh.client`. Licenses include
MIT, Apache-2.0, and LGPL-3.0-only. Recipes must preserve runtime, optional and
peer classifications, client artifacts, YAML patches, presets, static assets,
licenses, and provenance. Missing repository metadata remains visibly unknown.

Every selected tarball passed the initial absolute/parent-path scan and has a
recorded SHA-256. This establishes a deterministic corpus, not trust. Source
builds will run isolated and compare manifests with fixed published forms.

Harman-owned synthetic negative fixtures will cover traversal, escaping links,
device entries, missing patches, conflicts/cycles, DSH incompatibility, mutable
inputs, script network attempts, undeclared output, nondeterminism, bad/revoked
signatures, and secret-shaped environment capture.

# DSH upstream synchronization

Query the official npm registry, record the version, integrity, tarball SHA-256,
and source commit when available, then publish the frozen all-runtime-dependency
artifact through a trusted Harman Repository Runtime channel. `harman -Sy`
reports the candidate; `harman -Syu` or `harman runtime sync` imports it and
runs the compatibility contract before changing `latest`.

The blocking contract covers Profile loading, distinct DSH_HOME writes,
read-only Package views, no package-manager fallback, Cordis and `ctx.*`
lifecycle, Agent/LLM, Tool/Skill/MCP, Session, Settings/Credentials, the normal
Host/Client bridge, strict Remote transport, and inactive ambient DSH behavior.
Non-breaking candidates advance only state metadata; no Harman code or
per-version adapter is created.

A failed candidate is recorded as `breaking` and cannot become latest or launch.
Classify the failure as upstream defect, environment drift, or a changed public
boundary. Prefer a versioned external adapter, then a bridge change. A Runtime
patch is last resort and requires an ADR with exact upstream paths, ABI impact,
replay test, removal condition, and an upstreamable change. Harman Core never
moves into such a patch.

Pinned Profiles remain on their exact compatible record while latest Profiles
advance. Each run records the resolved version, source, hash, and timestamp; it
does not rewrite the declared channel policy.

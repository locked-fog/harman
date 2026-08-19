# Harman requirements traceability

Status values are `planned`, `implemented`, `verified`, and `blocked`. A row is
`verified` only when its implementation, automated test, remote evidence, and
user documentation links are all present. The project remains incomplete while
any row is not `verified`.

| ID | Proposal requirement | Design / ADR | Implementation | Automated test | Remote evidence | User docs | Status / risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-SCOPE-CONTROL | Harman is an external management plane; DSH remains the runtime | ADR-0001 | — | compatibility suite | — | architecture | planned; upstream boundary must be measured |
| P1-SCOPE-FORK | Fork DSH only when public extension points are insufficient; keep any patch minimal | ADR-0001 | — | upstream patch replay | — | maintainer guide | planned |
| P2-MODEL-BOUNDARY | Package, Resource, and Profile are distinct domain objects | domain model ADR | — | domain invariants | — | concepts | planned |
| P2-RESOURCE-INDEPENDENT | A Package may provide Resources; Resources need not come from Packages | domain model ADR | — | reference graph tests | — | concepts | planned |
| P3-PKG-SYNC | `harman -Sy` atomically synchronizes repository metadata | repository ADR | — | repo component / fault injection | — | CLI manual | planned |
| P3-PKG-SEARCH | `harman -Ss` searches repositories with stable text and JSON output | repository ADR | — | CLI integration | — | CLI manual | planned |
| P3-PKG-INSTALL | `harman -S` resolves and transactionally installs packages | solver / transaction ADRs | — | install E2E | — | CLI manual | planned |
| P3-PKG-REMOVE | `harman -R` previews impact and protects referenced objects | transaction ADR | — | removal / ownership E2E | — | CLI manual | planned |
| P3-PKG-UPGRADE | `harman -Syu` previews, locks, upgrades, and rolls back failures | solver / transaction ADRs | — | upgrade / rollback E2E | — | CLI manual | planned |
| P3-PKG-QUERY | `harman -Qi` explains version, origin, reason, dependencies, and Profile use | query graph ADR | — | CLI integration | — | CLI manual | planned |
| P3-PKG-UPSTREAMS | Recipes accept npm, GitHub releases, and source repositories without plugin modification | package format ADR | — | ecosystem fixtures | — | recipe guide | planned |
| P3-PKG-PREBUILT | Normal installation uses verified artifacts with frozen runtime dependencies and no npm/pnpm resolution | package format ADR | — | process / filesystem E2E | — | package guide | planned |
| P3-PKG-LOCAL-BUILD | Explicit local recipe build uses isolation and produces the same package format | recipe sandbox ADR | — | isolated build E2E | — | recipe guide | planned |
| P3-PKG-DEPS | Deterministic solver handles semver, transitive deps, conflicts, coexistence, pins, downgrades, orphans, and cycles | solver ADR | — | solver property / golden tests | — | CLI manual | planned |
| P3-PKG-IMMUTABLE | Store objects are content-addressed, verified, immutable, and garbage-collected by references | Store ADR | — | mutation / GC tests | — | admin guide | planned |
| P4-RES-SCAN | Read-only scanners discover user/project Skills, AGENTS.md, Prompts, MCP, and registered context types | Resource identity ADR | — | scanner fixtures | — | Resource guide | planned |
| P4-RES-COMMANDS | `scan/list/show/register/adopt/enable/disable/bind/detach` are complete | Resource identity ADR | — | CLI / E2E | — | Resource guide | planned |
| P4-RES-OWNERSHIP | external, managed, and package-provided ownership have distinct lifecycle rules | Resource identity ADR | — | negative ownership tests | — | Resource guide | planned |
| P4-RES-EXTERNAL-SAFE | No detach, uninstall, Profile delete, recovery, or interruption modifies external content | threat model | — | byte-for-byte negative tests | — | safety guide | planned |
| P4-RES-ADOPT | `adopt` is the only external-to-managed transition and previews target, impact, and rollback | Resource identity ADR | — | adopt transaction E2E | — | Resource guide | planned |
| P5-PROFILE-LIFECYCLE | Profiles support create/list/show/clone/rename/delete/diff/activate/deactivate/run/export/import/restore/doctor | Profile ADR | — | CLI / E2E | — | Profile guide | planned |
| P5-PROFILE-CONTENTS | Profiles compose packages, resources, plugin config, prompts, MCP, model config, Cordis Patch, and state | Profile ADR | — | materialization tests | — | Profile guide | planned |
| P5-PROFILE-ISOLATION | Each Harman Profile has a distinct DSH_HOME and private runtime state | Profile ADR | — | concurrent isolation E2E | — | Profile guide | planned |
| P5-PROFILE-MERGE | Composition order is deterministic; conflicts are merged by schema or rejected, never silently overwritten | Profile ADR | — | conflict matrix | — | Profile guide | planned |
| P5-PROFILE-EXPORT | Export includes exact packages, resource identity, runtime policy and resolution, config, and secret references | export schema ADR | — | schema / E2E | — | backup guide | planned |
| P5-PROFILE-RESTORE | Restore supports strict replay and follow-latest, offline cache, migration, and diagnostic failure | export schema ADR | — | clean-state restore E2E | — | backup guide | planned |
| P5-PROFILE-EQUIVALENCE | Reproducibility compares hashes, bindings, resolved config, and runtime inventory | export schema ADR | — | equivalence E2E | — | backup guide | planned |
| P5-RUNTIME-LATEST | Default policy follows only an officially published latest that passed compatibility validation | Runtime ADR | — | latest-channel E2E | — | Runtime guide | planned |
| P5-RUNTIME-PIN | Profiles may pin/unpin exact DSH versions and display policy, resolved version, latest, and status | Runtime ADR | — | pin lifecycle E2E | — | Runtime guide | planned |
| P5-RUNTIME-AUDIT | Each run records actual DSH version, source, and content hash without converting latest to a pin | Runtime ADR | — | audit assertions | — | Runtime guide | planned |
| P6-STOCK-DSH | Stock DSH loads Harman materialization while preserving Cordis, plugin ABI, ctx services, Agent/Tool/Skill/MCP/Session behavior | ADR-0001 | — | compatibility contract | — | compatibility guide | blocked on remote research |
| P6-READONLY-STORE | Profiles consume an OS-enforced read-only Store view; managed launch never calls `dsh plugin` or npm/pnpm | Store / Profile ADRs | — | readonly mount E2E | — | admin guide | planned |
| P6-REGENERABLE | DSH-generated cordis.yml, fallback links, and caches remain regenerable and outside authoritative locks | Profile ADR | — | rebuild / drift tests | — | Profile guide | planned |
| P7-WEB-BRIDGE | A normal Host/Client bridge registers a discoverable DSH Settings management UI | ADR-0002 | — | bridge / browser E2E | — | Web guide | blocked on remote research |
| P7-WEB-COVERAGE | Web covers Profile, Runtime, Package, Resource, Repository, diagnostics, and drift | ADR-0002 | — | browser feature matrix | — | Web guide | planned |
| P7-WEB-TRANSACTION | All Web writes use authenticated Core transactions with impact and audit | ADR-0002 | — | API / browser E2E | — | Web guide | planned |
| P7-WEB-FAIL-CLOSED | Disconnect, stale state, failure, and rollback are explicit and writes fail closed | ADR-0002 | — | browser fault tests | — | Web guide | planned |
| P7-WEB-QUALITY | Real UI passes keyboard, screen-reader, responsive, loading, progress, refresh, and consistency checks | Web design spec | — | accessibility / browser E2E | — | Web guide | planned |
| P8-REPO-GITHUB | A trusted personal GitHub repository carries recipes, index, metadata, CI, and release artifacts | repository ADR | — | publication contract | — | repository guide | planned; publication requires separate authority |
| P8-REPO-MULTI | Multiple repositories support priority and deterministic conflict handling | repository ADR | — | multi-source E2E | — | repository guide | planned |
| P8-REPO-TRUST | Artifact/index signing, verification, rotation, revocation, replay, downgrade, and explicit distrust are enforced | trust-root ADR | — | security E2E | — | trust guide | planned |
| P9-SECURITY | Threat model covers hostile inputs, traversal, symlink escape, build scripts, confusion, injection, secrets, and deletion | threat model | — | security suite | — | security guide | planned |
| P9-TRANSACTION | State schemas are versioned; mutations are locked, durable, atomic, recoverable, and audited | state DB ADR | — | kill / disk-full / concurrency tests | — | admin guide | planned |
| P10-EXPLAIN | Queries explain origin, ownership, reason, references, exact versions, runtime policy, and upgrade impact | query graph ADR | — | explain golden tests | — | CLI/Web guides | planned |

## Evidence rule

Remote evidence is linked as `evidence/<milestone>/<run-id>/manifest.json`.
Large or sensitive logs remain on the test workstation; the committed manifest
contains redacted summaries and SHA-256 hashes. Publication, release, push, and
tagging are outside development-test authorization.

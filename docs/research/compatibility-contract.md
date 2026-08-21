# DSH compatibility contract

The contract describes supported behavior, not one DSH version. `latest`
advances only when all blocking assertions pass against the official artifact.
The 1.0.0-pre-2 preparation follows DSH `latest` and records its exact
resolution in the release build manifest.

| ID | Assertion | 1.0.0-pre-2 status |
| --- | --- | --- |
| C-RUNTIME-ID | version, source, integrity, and source commit are recorded | pass; release build manifest records DSH npm metadata, integrity, SHA-256, and source commit |
| C-HOME-RESOLVE | DSH_HOME contains every stock user write path | mapped; local and codex-test smoke evidence |
| C-PROFILE-LOAD | bundles resolve/compose; invalid layers fail | pass; Profile and upstream fixture suites |
| C-PROFILE-ISOLATE | two DSH_HOME roots do not cross-write | pass; concurrent profile and real CLI evidence |
| C-PLUGIN-STOCK | community bundle lifecycle is unmodified | pre-2 regression required; stock/community evidence is retained separately from Harman-path evidence |
| C-CORDIS | lifecycle/effects/required services remain stable | pass through scope/lifecycle suites; DSH-derived root lifecycle is documented separately |
| C-DSH-DERIVED | DSH-generated `cordis.yml` and cache follow the upstream lifecycle boundary | local ownership regression pass; exact latest runtime evidence required before stable promotion |
| C-AGENT | Agent Loop/model config run with mock provider | pass; upstream Agent/LLM suites |
| C-TOOL-SKILL-MCP | registrations/invocations preserve lifecycle | pass; upstream Tool/Skill/MCP suites |
| C-SESSION | create/append/flush/resume/isolation work | pass; upstream Session/JSONL suites; Bridge `JsonValue` is checked against official Session |
| C-STORE-RO | DSH loads from OS-enforced read-only Store view | pass; read-only Store evidence |
| C-NO-PNPM | managed run invokes no package manager/lockfile | pass; managed launch evidence |
| C-WEB-SLOT | client bundle registers `settings.section` | prior M7 Chromium pass; fresh pre-2 artifact recheck remains release evidence |
| C-REMOTE | typed API validates and rejects stale writes | prior M7 stale-write pass; fresh pre-2 artifact recheck remains release evidence |
| C-INACTIVE | ambient DSH unchanged when Harman is inactive | pending integration |
| C-UPDATE-LIFECYCLE | upgrade, uninstall, community plugins, and non-Harman paths preserve their contracts | pre-2 regression required; must be reported independently of Harman profile tests |

The expanded remote baseline passed 80 files and 1,796 assertions across Agent,
Agent Loop, LLM, Tool, Skill, MCP, Session, JSONL persistence, Settings, and
Credentials. That baseline proves the stock extension/runtime seams needed to
start M1; it does not substitute for the fresh pre-2 artifact, community
plugin, update/uninstall, inactive-path, or real-browser evidence.

Rows about Harman artifacts remain blocking for their own milestones and for
final latest promotion. A successful npm build alone does not promote the
runtime or close the M7 checklist.

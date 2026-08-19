# DSH compatibility contract

The contract describes supported behavior, not one DSH version. `latest`
advances only when all blocking assertions pass against the official artifact.

| ID | Assertion | M0 baseline |
| --- | --- | --- |
| C-RUNTIME-ID | version, source, integrity, and source commit are recorded | pass |
| C-HOME-RESOLVE | DSH_HOME contains every stock user write path | mapped; smoke pass |
| C-PROFILE-LOAD | bundles resolve/compose; invalid layers fail | 14 tests pass |
| C-PROFILE-ISOLATE | two DSH_HOME roots do not cross-write | real CLI pass |
| C-PLUGIN-STOCK | community bundle lifecycle is unmodified | pending Harman fixture |
| C-CORDIS | lifecycle/effects/required services remain stable | covered through scope/lifecycle suites; pass |
| C-AGENT | Agent Loop/model config run with mock provider | upstream Agent/LLM suites pass |
| C-TOOL-SKILL-MCP | registrations/invocations preserve lifecycle | upstream Tool/Skill/MCP suites pass |
| C-SESSION | create/append/flush/resume/isolation work | upstream Session/JSONL suites pass |
| C-STORE-RO | DSH loads from OS-enforced read-only Store view | pending materializer |
| C-NO-PNPM | managed run invokes no package manager/lockfile | pending launcher |
| C-WEB-SLOT | client bundle registers `settings.section` | source tests pass; bridge pending |
| C-REMOTE | typed API validates and rejects stale writes | source tests pass; API pending |
| C-INACTIVE | ambient DSH unchanged when Harman is inactive | pending integration |

The expanded remote baseline passed 80 files and 1,796 assertions across Agent,
Agent Loop, LLM, Tool, Skill, MCP, Session, JSONL persistence, Settings, and
Credentials. M0 therefore proves the stock extension/runtime seams needed to
start M1. Rows about Harman artifacts remain blocking for their own milestones
and final latest promotion.

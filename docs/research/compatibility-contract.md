# DSH compatibility contract

The contract describes supported behavior, not one DSH version. `latest`
advances only when all blocking assertions pass against the official artifact.

| ID | Assertion | M0 baseline |
| --- | --- | --- |
| C-RUNTIME-ID | version, source, integrity, and source commit are recorded | pass |
| C-HOME-RESOLVE | DSH_HOME contains every stock user write path | mapped; smoke pass |
| C-PROFILE-LOAD | bundles resolve/compose; invalid layers fail | 14 tests pass |
| C-PROFILE-ISOLATE | two DSH_HOME roots do not cross-write | real CLI pass |
| C-PLUGIN-STOCK | community bundle lifecycle is unmodified | M4/M7 stock/community evidence passes; fresh npm-built Bridge recheck pending |
| C-CORDIS | lifecycle/effects/required services remain stable | covered through scope/lifecycle suites; pass |
| C-AGENT | Agent Loop/model config run with mock provider | upstream Agent/LLM suites pass |
| C-TOOL-SKILL-MCP | registrations/invocations preserve lifecycle | upstream Tool/Skill/MCP suites pass |
| C-SESSION | create/append/flush/resume/isolation work | upstream Session/JSONL suites pass |
| C-STORE-RO | DSH loads from OS-enforced read-only Store view | M4 read-only Store evidence passes; fresh release integration recheck pending |
| C-NO-PNPM | managed run invokes no package manager/lockfile | managed launch evidence passes; fresh release integration recheck pending |
| C-WEB-SLOT | client bundle registers `settings.section` | M7 Chromium evidence passes for the prior artifact; `1.0.0-pre-1` recheck pending |
| C-REMOTE | typed API validates and rejects stale writes | M7 stale-write evidence passes for the prior artifact; `1.0.0-pre-1` recheck pending |
| C-INACTIVE | ambient DSH unchanged when Harman is inactive | pending integration |

The expanded remote baseline passed 80 files and 1,796 assertions across Agent,
Agent Loop, LLM, Tool, Skill, MCP, Session, JSONL persistence, Settings, and
Credentials. M0 therefore proves the stock extension/runtime seams needed to
start M1. Rows about Harman artifacts remain blocking for their own milestones
and final latest promotion.

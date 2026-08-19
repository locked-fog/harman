# M0 risk and question register

| ID | Class | State / closure |
| --- | --- | --- |
| R-MODULE-VIEW | M4 blocker | prove loading from an OS read-only mount without fallback mutation |
| R-CLIENT-BUILD | M7 blocker | reproduce unpublished client bundle format and pass loader/browser tests |
| R-RUNTIME-PLUGIN-TRUST | accepted boundary | plugins have DSH-process authority; Harman does not claim a runtime sandbox |
| R-EARLY-DSH-ABI | ongoing | peers span rc.5-rc.7; solver must report compatibility |
| R-RECIPE-SANDBOX | M2 blocker | select and prove isolation; refuse when unavailable |
| R-STATE-DB | M1 blocker | ADR plus kill/disk-full recovery tests required |
| R-SIGNING-ROOT | M6 blocker | define offline root, delegation, expiry, rotation, revocation |
| R-GITHUB-PUBLISH | separate authority | test locally; actual push/release needs authorization |
| R-BROWSER-ACCEPT | M7 blocker | live Web transactions, accessibility, responsive evidence |
| R-SYSTEM-PACKAGE | system-test gate | create Snapper snapshot before system mutation |

No open item is silently treated as complete. Milestone blockers remain attached
to their exit gates.

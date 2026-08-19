# Remote evidence format

Every remote run produces a small committed manifest and a remote log bundle.
The manifest is evidence, not a substitute for the underlying logs.

## Directory layout

```text
evidence/<milestone>/<UTC-run-id>/
  manifest.json
  summary.md
```

Large logs remain under `~/test-work/harman/evidence/<UTC-run-id>/` on the
test workstation. Secret-bearing environment, credentials, SSH material, and
package signing private keys are never collected.

## Required manifest fields

```json
{
  "schema_version": 1,
  "run_id": "YYYYMMDDTHHMMSSZ-short-name",
  "milestone": "M0",
  "started_at": "RFC3339",
  "finished_at": "RFC3339",
  "remote": {
    "ssh_alias": "redacted-if-needed",
    "hostname": "name",
    "user": "name",
    "os": "name/version",
    "kernel": "version",
    "arch": "arch",
    "filesystem": "type"
  },
  "source": {
    "harman_commit": "sha-or-WORKTREE",
    "working_tree_patch_sha256": "sha256-or-null",
    "dsh_channel": "latest",
    "dsh_version": "exact",
    "dsh_commit": "sha-or-null",
    "dsh_artifact_sha256": "sha256"
  },
  "recovery": {
    "snapper_config": "root-or-null",
    "pre_test_snapshot": "number-or-null",
    "snapshot_reason": "text-or-null",
    "rebooted": false
  },
  "tests": [
    {"id": "stable-test-id", "command": "redacted command", "result": "pass|fail|skip", "log_sha256": "sha256"}
  ],
  "persistent_remote_changes": [],
  "result": "pass|fail|partial",
  "unresolved_risks": []
}
```

## Collection rules

1. Every SSH/SCP command explicitly uses `/home/Locked_Fog/.ssh/config`, batch
   authentication, host-key checking, and the one confirmed alias.
2. A dirty local tree is transferred as files; it is never committed merely
   for transfer. Record a hash of the reviewed patch when applicable.
3. Create and retain a Snapper snapshot before system packages, `/etc`, `/usr`,
   systemd, kernel, driver, or uncertain system-state changes.
4. Expected failures must still record their real exit status. Do not mask
   commands with unconditional success.
5. Hash each log before redaction; commit only a redacted summary and the hash.
6. A result is `pass` only when assertions checked behavior, not merely process
   startup.

# Core state, audit, explain, and impact

Harman keeps authoritative control-plane metadata below `HARMAN_HOME` (default
`~/.harman`). Override it for testing or isolated administration with either
`HARMAN_HOME=/path` or the higher-priority `--home /path` option. A blank
environment value is ignored and never resolves to the current directory.

Initialize and inspect the state without installing packages or changing DSH:

```bash
harman state init
harman --json state show
```

The state document is schema-versioned and revisioned. Writers use one durable
transaction with an intent journal, temporary file, fsync, atomic rename, and a
coupled redacted audit event. A future schema is refused; it is never rewritten
implicitly. A dead writer lock is reclaimed only after its recorded PID is no
longer alive, and its journal is classified as committed or aborted from hashes.

Queries answer why and where an object is used:

```bash
harman explain package name@1.2.3
harman explain resource skill/example
harman explain profile coding
harman impact package name@1.2.3
harman impact profile coding
```

Use `--json` for stable machine-readable values. Error JSON has the form
`{"error":{"code":"...","message":"...","details":...}}`. Current exit
classes are: validation 3, conflict 4, not found 5, busy writer 6, stale revision
7, unsupported schema 8, and unexpected internal error 1.

An impact response is advisory. A later transaction always rechecks its
revision and invariants; callers must not assume an old `allowed: true` remains
valid. Removing a reference to an external Resource never authorizes Harman to
modify or delete the referenced file.

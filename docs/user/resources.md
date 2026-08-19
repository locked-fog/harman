# Resources

Harman can organize Skills, `AGENTS.md`, Prompt/Markdown files, MCP configuration
locations, and explicitly registered context without requiring them to be
packages.

```text
harman resource scan [PROJECT]
harman resource list
harman resource show skill/example
harman resource register prompt ./review.md --id prompt/review --scope project
harman resource disable prompt/review
harman resource enable prompt/review
harman resource bind prompt/review --profile work
harman resource detach prompt/review --profile work
harman --dry-run resource adopt prompt/review
harman --yes resource adopt prompt/review
```

`scan` checks user and project `.agents/skills`, `.agents/prompts`, project
`AGENTS.md`, user Codex configuration, and project `.mcp.json`. It refuses
symbolic links and never automatically adopts files. A missing scanned Resource
is retained with `available: false`, so a temporarily unmounted project is not
mistaken for deletion.

`external` means Harman stores only identity and relationships. Detach, Profile
deletion, and record changes do not touch the path. `managed` means an explicitly
adopted copy below Harman's private managed root. Adoption preserves the source,
requires `--yes`, and can be previewed with `--dry-run`. Package-provided
Resources remain tied to their immutable Package Store object and cannot be
adopted.

MCP files may contain credentials. Harman records only their location and file
metadata fingerprint during discovery; secret values are neither copied into
state nor written to audit logs. Profiles later resolve secrets through explicit
secret references.

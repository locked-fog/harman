# M0 remote research plan

M0 performs research and establishes executable contracts. It does not contain
business implementation. Local source and documentation remain authoritative;
the remote workspace is disposable.

## Gate A: confirmed target and read-only preflight

- Obtain one explicit SSH host/alias from the user.
- Verify local `ssh`, `scp`, Git, readable SSH config, repository root, and
  working-tree state.
- Connect non-interactively and record host, user, kernel, OS, architecture,
  filesystem, free space, network boundaries, and tool versions.
- Check `sudo -n true`, Snapper configs, and root snapshots without modifying
  the system.
- Create `~/test-work/harman` and its evidence directory. This is the only
  remote location used for normal source and research artifacts.

Exit: baseline evidence manifest exists and unattended SSH, privilege, and
recovery capabilities are truthfully classified.

## Gate B: official DSH latest baseline

- Resolve the official source/release location and the current `latest` on the
  remote host; preserve version, commit where available, artifact hash, and
  resolution timestamp.
- Inspect repository layout, package manager, build/release process, license,
  plugin discovery and lifecycle, package metadata, Cordis and `ctx.*`, and all
  Tool/Skill/MCP/Prompt/Session/model/config/Patch storage and loading paths.
- Record user/project configuration precedence, mutations, migrations, module
  resolution, generated state, and Web Host/Client/Settings extension points.
- Cite the fixed commit and exact file/line ranges in `dsh-baseline.md`.

Exit: every required Harman integration point is mapped to stock DSH behavior;
unsupported assumptions are listed as blockers rather than silently filled in.

## Gate C: compatibility contract

Build executable probes for:

- stock plugin discovery, load, invocation, disable, and uninstall;
- Cordis lifecycle and required `ctx.*` services;
- Agent Loop, Tool, Skill, MCP, Session, and model configuration;
- distinct `DSH_HOME` instances and concurrent writes;
- profile-local module view backed by an OS-enforced read-only store;
- bridge Host Remote, client plugin, and Settings registration;
- harmless behavior when Harman is inactive.

Define non-breaking as a new official latest passing all supported contract
assertions without Harman source changes. A failure is classified as upstream
defect, environmental change, or breaking interface change before adapter work.

Exit: the contract runs against the fixed baseline and produces machine-readable
results.

## Gate D: ecosystem samples

Select pinned, license-compatible public samples covering plain JavaScript,
TypeScript build output, runtime dependencies, optional/peer dependencies, npm,
GitHub release, source-only, lifecycle scripts, native extension, resource
assets, and Cordis Patch. Create local negative fixtures for missing metadata,
dependency conflicts, traversal, symlink escape, mutable source, and
non-reproducible output.

Do not patch a sample to make it compatible. Record selection rationale,
source version, checksum, license, expected behavior, and actual contract result.

## Gate E: M0 decision package

Complete the fixed-commit DSH report, compatibility support matrix, unresolved
questions register, stock-control-plane ADR, Web bridge ADR, threat model, and
traceability links. Classify each unresolved issue as blocker, deferred with a
defined acceptance boundary, or explicitly accepted risk.

M1 may start only after all M0 blockers are closed and remote evidence is
reviewable.

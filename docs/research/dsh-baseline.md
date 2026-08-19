# DSH baseline at Harman M0

Research ran on `codex-test`. The immutable source baseline is official tag
`dsh-v0.1.0-rc.7`, commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`.
At 2026-08-19T08:39:46Z npm `latest` and `next` both resolved to
`@deepseek-ai/dsh@0.1.0-rc.7`.

The npm artifact SHA-256 is
`2f8f0b763d611ac536f7a9411ee43c0afc067c1b8732c3102c04dbe398bcacc5`;
npm shasum is `8a69013c06179d7af437de92fb4a9a2e1fd7d410`. Package and
repository declare MIT, and the source commit is tagged with the exact version.

## Build and release baseline

The repository is a 238-project pnpm workspace. Root `package.json:1-26`
declares Node `^22.19.0 || >=24`, pnpm 11.7.0, and separate host, client, and Web
builds. `pnpm-workspace.yaml:1-55` uses local Cordis overrides and denies
dependency build scripts by default except reviewed entries. Release tooling is
under `scripts/release/`; `apps/cli/package.json:1-26` publishes `dsh`.

The fixed checkout installed with its frozen lock on Node 26.7.0 and pnpm
11.7.0. Five focused seam files passed 88 assertions. An expanded runtime
contract then passed 80 files and 1,796 assertions across Agent, Agent Loop,
LLM, Tool, Skill, MCP, Session/JSONL, Settings, and Credentials.

## Runtime and Profile contract

- `packages/util/home-paths/src/index.ts:77-90` defines precedence: explicit
  path, `DSH_HOME`, then `~/.dsh`. Harman can isolate Profiles with distinct
  DSH_HOME values.
- `packages/boot/app-boot/src/profile.ts:98-125` validates Profile names and
  locates them below `<DSH_HOME>/profiles`; Web and headless templates are
  explicit bundle tuples.
- `packages/boot/app-boot/src/profile.ts:145-168` initializes the manifest,
  patch, and pnpm settings. Harman will generate the manifest/patch but never
  invoke this pnpm management path.
- `packages/boot/app-boot/src/profile.ts:204-255` maintains the
  installation-owned module fallback.
- `packages/boot/app-boot/src/profile.ts:332-403` resolves DSH-installation
  bundles before Profile-local bundles and fails loudly on invalid layers.
- `packages/boot/app-boot/src/profile.ts:405-420` composes layers with the same
  function used by boot, giving doctor/dump a stable oracle.

A real official npm installation was run with two fresh homes. `home-a` created
only Web (`dsh-base`, `dsh-web-app`); `home-b` created only headless (`dsh-base`,
`dsh-headless`). Cross-home Profile files were asserted absent.

## Existing plugin management and Harman boundary

`apps/cli/src/plugin.ts:1-9` describes `dsh plugin` as a thin pnpm forwarder;
`:120-157` creates a Profile, spawns pnpm, then reconciles dependencies into
bundle layers. Harman-managed Profiles therefore must not call `dsh plugin`.
They must expose verified Store content through a module view and transactionally
write the authoritative manifest.

Stock DSH defines a bundle through `dsh.bundle.patch`; an optional browser half
is exported at `./client` and declared by `dsh.client`. Current community
packages use both contracts without Harman-specific adaptation.

## Persistence and Resource integration points

- `packages/settings/settings-file/src/index.ts:51-56` defaults to
  `<DSH_HOME>/settings.yaml`.
- `packages/credentials/credentials-local/src/index.ts:1-7,52-75` owns
  `<DSH_HOME>/.credentials.yaml` and layers environment sources.
- `packages/bundle/base/cordis.patch.yml:75-101` binds settings, credentials,
  and sessions below `<DSH_HOME>/sessions`.
- `packages/bundle/web-app/cordis.patch.yml:51-57` stores JSON data below
  `<DSH_HOME>/storages`.
- `packages/skill/skill-filesystem/src/index.ts:246-254` discovers project
  `.dsh/skills`, project `.agents/skills`, DSH-home skills, and user skills.
- `packages/context/agent-instructions/src/config.ts:12-19` covers project
  instructions and the DSH-home global `AGENTS.md`.
- `packages/mcp/mcp-client/src/index.ts:28-82,144-181` defines one MCP server
  instance per row and fails conflicts explicitly.
- authored presets live under `<DSH_HOME>/.agent-presets/<id>` per
  `apps/cli/config/agent-presets/cordis/agent.cordis.yml:27`.

These write paths are captured by a distinct DSH_HOME. External Resources stay
references until Harman materializes a view or explicitly performs `adopt`.

## Web extension boundary

`docs/cookbook/adding-a-settings-card.md:5-11` says an out-of-tree package needs
no DSH source edit: its Host half registers a namespace and browser half uses
`dsh.client`. `:44-70` establishes secret redaction and revision-fenced writes;
`:78-100` documents client-module discovery and packaging.

For a whole Harman page,
`packages/client/ui-settings/src/client/contract/slots.ts:43-53` defines public
`settings.section`. `packages/api/gateway/README.md:5-25` documents the typed
Host gateway and Client `ctx.remote`, including argument/result validation.

The shared client bundle preset is not published (`adding-a-settings-card.md:
92-100`). Harman must reproduce the documented lazy-CJS format and verify it
against client-module tests. This is an adapter/build issue, not grounds for a
Runtime fork.

## Change classification

A DSH update is non-breaking only when the executable contract passes unchanged:
Profile load/dump, DSH_HOME isolation, bundle/client discovery, Cordis services,
Agent/Tool/Skill/MCP/Session behavior, Settings slots, and Remote transport.
A failure is classified as upstream defect, environment change, or breaking
dependency before adapter work.

No stock DSH fork is currently justified. The ADRs remain proposed until the
Harman bridge and OS-enforced read-only Store view pass end-to-end tests.

# Harman

Harman is an external package, Resource, Profile, and Runtime control plane for
stock DeepSeek Harness (DSH). It keeps npm/pnpm in reviewed build pipelines,
installs verified prebuilt artifacts into a content-addressed Store, gives each
Profile its own `DSH_HOME`, and exposes the same transaction model through its
CLI, local daemon API, and normal DSH Web bridge plugin.

## Quick start

```bash
node scripts/install.mjs --prefix "$HOME/.local"
harman state init
harman repo add community https://raw.githubusercontent.com/locked-fog/harman/main/evidence/releases/1.0.0-pre-1/index.json 10
harman -Sy
harman -Ss sidebar
harman -S package-name
harman profile create work --app web
harman profile run work
```

The repository URL above is the `1.0.0-pre-1` public pre-release index. See `docs/user/installation.md`,
`docs/user/package-management.md`, `docs/user/resources.md`, and
`docs/user/profiles-and-runtimes.md` for operational use. The acceptance state
and evidence links live in `docs/requirements/traceability.md`.

Harman never removes external Resources, never performs package-manager
resolution during ordinary package installation, and refuses unvalidated or
breaking DSH Runtime candidates. See `docs/release/1.0.0-pre-1.md` for the
accepted pre-release risks and the retained M7 checklist.

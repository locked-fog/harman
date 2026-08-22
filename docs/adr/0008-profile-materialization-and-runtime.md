# ADR-0008: Profile materialization and DSH Runtime policy

Status: accepted for the headless control-plane boundary (2026-08-19)

Every Harman Profile owns a distinct `<HARMAN_HOME>/profiles/<name>/dsh-home`.
Inside it Harman writes one stock DSH Profile named `harman`, a deterministic
package manifest, Cordis patch, Resource views, and `harman.lock.json`. Package
module links point at immutable content-addressed Store objects; no `dsh plugin`,
npm, pnpm, lifecycle script, or lockfile generation participates.

DSH Runtimes are records separate from Packages. `{channel:"latest"}` resolves
the one Runtime selected as latest, including a locally detected or otherwise
unvalidated candidate. `{version:"..."}` resolves an exact record. A breaking
or unvalidated result is retained as a diagnostic and does not block latest or
launch; users can pin an older exact version when an upstream release does not
work. Each run audits the resolved version,
source, hash, and timestamp without replacing the Profile's channel policy.

Launch requires `bubblewrap`. The host root, including Store and other Profile
homes, is mounted read-only; `/tmp` is private and only the selected DSH_HOME is
writable. Network remains available for model providers. Missing isolation
fails closed. This is OS enforcement, not a claim that trusted plugins are
otherwise sandboxed from data visible in the process.

Prompt and instruction Resources are composed with provenance into the private
DSH_HOME; Skill locations are linked read-only through the root view. Literal
secret-looking configuration is rejected in favor of `secretRef`. Generated
DSH state such as settings, sessions, storages, and caches remains under the
private DSH_HOME and outside the authoritative Harman lock. In the stock DSH
profile boot, `profiles/harman/cordis.yml` is a derived root rewritten by DSH;
Harman owns the adjacent `cordis.patch.yml` input and deliberately does not
restore or lock the generated root during rematerialization. DSH startup is
responsible for recreating that root after Harman rebuilds the profile view.

# Profiles and DSH Runtimes

Register a previously verified official DSH executable and select it as latest:

```text
harman runtime register 0.1.0-rc.7 /path/to/dsh <sha256> npm:@deepseek-ai/dsh@0.1.0-rc.7 --official
harman runtime latest dsh@0.1.0-rc.7
harman runtime list
```

Profiles default to the compatible latest channel. Use `--runtime VERSION` for
an exact pin. The resolved run fact is recorded separately and never turns a
latest policy into a pin.

```text
harman profile create work
harman profile create stable --runtime 0.1.0-rc.7
harman profile list
harman profile show work
harman profile clone work experiment
harman profile rename experiment renamed
harman profile diff work renamed
harman profile materialize work
harman profile activate work
harman profile deactivate work
harman profile runtime work 0.1.0-rc.7
harman profile runtime work latest
harman profile run work --dump-config
harman profile doctor work
harman profile export work ./work.bundle
harman profile restore ./work.bundle restored --mode strict
harman profile restore ./work.bundle current --mode follow-latest
harman --dry-run profile delete renamed
harman --yes profile delete renamed
```

For packages, resources, plugin configuration, prompts, MCP, model configuration,
and Cordis Patch, pass `--config FILE` on creation. Secret fields must use
objects such as `{"secretRef":"env:MODEL_KEY"}`. Each Profile has its own
DSH_HOME. The shared Store and every other Profile are read-only during a run;
the selected Profile alone can write settings, credentials, sessions, storage,
presets, and caches.

`doctor` reports the declared Runtime policy, latest version, last resolved
version/hash, manifest and lock presence, running state, and every Store link.
An unresolved, breaking, or unvalidated Runtime prevents launch.

Export bundles carry verified Package content and managed Resource copies for
offline restoration. External files are never copied or adopted; restore
requires their recorded paths and fingerprints to match. `strict` replays the
last resolved Runtime exactly. `follow-latest` retains the channel policy and
resolves the currently validated latest. Both modes report semantic lock
equivalence and reject a modified manifest or object.

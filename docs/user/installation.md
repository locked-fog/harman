# Installation, upgrade, and removal

Harman requires Node.js 22.19 or newer. Profile launch and local recipe builds
require Linux bubblewrap (`bwrap`). DSH is discovered from the global npm
installation when possible, or can be followed from a configured repository;
it is not vendored into Harman.

Install into a user prefix:

```bash
node scripts/install.mjs --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
harman init
```

`harman init` creates the `default` Profile and runs the automatic DSH
discovery. If discovery finds nothing, the state is still initialized; run
`harman runtime detect` after installing `@deepseek-ai/dsh` globally. The
advanced manual form remains available as `harman runtime register ...`, but
ordinary users do not need to calculate a Runtime hash or select a version
by hand.

Running the same command performs an atomic program upgrade. The installer
stages a complete copy, swaps the program directory, validates ownership of
existing launchers and the user systemd unit, and restores the previous program
directory if publication fails. It does not touch `~/.harman`.

The generated unit is
`$PREFIX/share/systemd/user/harman-daemon.service`. Copy or link it into the
user systemd search path, then explicitly enable it if desired. The daemon uses
an owner-only Unix socket and bearer-token file below `HARMAN_HOME`; it never
opens a TCP listener.

Uninstall only owned program files:

```bash
node scripts/install.mjs --prefix "$HOME/.local" --uninstall
```

The uninstaller refuses modified launchers, a modified unit, or a program tree
without the matching ownership marker. Profile state and `~/.harman` are
preserved deliberately. Remove that data separately only after exporting any
Profiles that must survive.

For a system prefix such as `/usr/local`, run the same installer with suitable
privilege. System-level testing must be protected by the host's snapshot and
recovery policy; Harman does not invoke `sudo` itself.

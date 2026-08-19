# Installation, upgrade, and removal

Harman requires Node.js 22.19 or newer. Profile launch and local recipe builds
require Linux bubblewrap (`bwrap`). DSH itself is supplied as a verified Runtime
record or as a repository Runtime artifact; it is not vendored into Harman.

Install into a user prefix:

```bash
node scripts/install.mjs --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
harman state init
```

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

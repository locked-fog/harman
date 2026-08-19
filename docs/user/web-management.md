# DSH Web management

Install `@harman/dsh-bridge` into a Web Profile and run `harman-daemon` against
the same `HARMAN_HOME`. The normal DSH Host/Client bundle registers a Harman
section in the public `settings.section` slot; no DSH source patch is used.

The page covers repository search and trust settings, verified package
install/remove/upgrade, Resource ownership and Profile binding, Profile
create/clone/rename/diff/export/restore/activate/delete, Runtime latest and
pinning, audit history, inventory, and doctor results. Every write follows:

1. fetch an authenticated snapshot and revision;
2. request a Core-generated impact preview;
3. show the preview in a modal confirmation boundary;
4. commit with the expected revision;
5. display the refreshed authoritative snapshot.

The browser never reads the daemon token, Store, Profile files, npm, or pnpm.
The Host bridge alone reads the owner-only token and talks to the Unix socket.
An intervening transaction returns `STALE_REVISION`; the page discards its
pending action and refreshes. A missing daemon or Remote failure switches the
page to explicit read-only state and disables mutations.

Keyboard focus uses a visible amber ring, navigation exposes `aria-current`,
status updates use a polite live region, and the impact surface is a labelled
modal dialog. At narrow widths the rail becomes a horizontal navigation strip,
forms stack, tables remain horizontally scrollable, and reduced-motion users
receive a static loading placeholder.

Troubleshooting order: run `harman profile doctor NAME`, verify owner-only modes
on `daemon.sock` and `daemon.token`, confirm daemon and Profile use the same
`HARMAN_HOME`, then inspect the recent audit list. Do not work around a daemon
failure by editing `harman.lock.json`, the Store, or generated Profile files.

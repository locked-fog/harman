# Local daemon API

The daemon serves HTTP/JSON on an owner-only Unix socket. Every request requires
`Authorization: Bearer <daemon.token>`; bodies are limited to 1 MiB and
responses use `no-store` and `nosniff` headers.

- `GET /v1/health` reports readiness.
- `GET /v1/snapshot` returns revisioned Package, Resource, Profile, Repository,
  Runtime, audit, inventory, and doctor state.
- `POST /v1/query` performs read-only search or Profile diff queries.
- `POST /v1/preview` returns impact and the expected revision.
- `POST /v1/transactions` requires action, input, expected revision, and an
  explicit confirmation for destructive operations.

Stable errors include `UNAUTHORIZED`, `VALIDATION_ERROR`, `CONFLICT`,
`NOT_FOUND`, `STATE_BUSY`, and `STALE_REVISION`. Automation should preview,
display or persist the impact, then commit once. It must never retry a stale
mutation blindly; fetch a new snapshot and recompute the plan.

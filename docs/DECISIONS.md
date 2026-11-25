# Relay API Platform — Decisions & Tradeoffs

This document explains why the project is built the way it is, and what would change at scale.

## Decisions

### Express 5 instead of a full framework

Express is small, well understood and keeps the request lifecycle visible. For a portfolio project, readable handlers are more valuable than framework magic. The cost is that cross-cutting concerns (validation, logging, auth) are hand-written — which is why they are isolated in middleware.

### SQLite via `node:sqlite`

Node 22+ ships a built-in SQLite binding, so there is no native driver to install and no external service to start. The whole backend runs with `npm run server`. This makes the demo reproducible on any machine.

**Tradeoff:** SQLite is a single-writer, local file. It is not suitable for multi-instance deployment or high concurrency.

### A static bearer token

`RELAY_API_KEY` defaults to `rly_live_demo`. It exists so the demo has a real auth boundary without an identity provider. Health and OpenAPI routes are public so monitoring and client generation work without credentials.

**Tradeoff:** this is not user identity, has no rotation, and must never be used publicly.

### Idempotency stored in the database

The `UNIQUE` constraint on `idempotency_key` makes retries safe even if two identical requests race. The replay is derived from the stored row, so the response is identical to the original.

### Cursor pagination over encoded offsets

The cursor is base64url-encoded `offset:<n>`. It is opaque to the client, testable and simple to reason about.

**Tradeoff:** offset cursors can skip or repeat rows when new events are inserted between pages. Keyset pagination on `(created_at, id)` would be correct under concurrent writes.

### One envelope and one error shape

Every response carries `request_id` and `api_version`. Errors carry a stable `code` and a human-readable `message`. This makes client handling and support conversations predictable.

### Seed data on first run

An empty database makes the dashboard boring. Eight deterministic events are inserted only when the table is empty, so tests and fresh installs behave the same way.

### Static console in the public demo

GitHub Pages cannot run Node, so the published console simulates responses. The README says this explicitly. Hiding that fact would be misleading; showing it invites the right question — "where is the real backend?" — which the full-stack setup answers.

## Known limits

- No user accounts, roles or per-tenant data isolation
- No rate limiting, request signing or replay window for idempotency keys
- No migrations; schema is created with `CREATE TABLE IF NOT EXISTS`
- No structured logging or metrics export
- Analytics reads at most 100 events, so aggregates are approximate at higher volume
- CORS allows all origins, appropriate only for a local demo

## What I'd change at scale

1. **PostgreSQL + migrations** — replace SQLite with a managed database and versioned schema changes.
2. **Real identity** — OAuth 2.0 / JWT with scoped tokens and key rotation instead of a static bearer key.
3. **Keyset pagination** — cursor on `(created_at, id)` to stay stable under concurrent writes.
4. **Server-side aggregation** — rollups in a materialised view or warehouse rather than scanning recent rows per request.
5. **Reliability** — rate limiting, request signing, idempotency expiry, outbox pattern and dead-letter handling.
6. **Observability** — structured JSON logs, distributed tracing, `request_id` propagation and SLO dashboards.
7. **Deployment** — containerised Node service behind TLS, secrets in a manager, horizontal scaling and health checks.
8. **Contract discipline** — generated client SDKs, schema validation middleware and contract tests in CI.

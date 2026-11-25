# Relay API Platform — Architecture

## Purpose

Relay is a versioned REST API backed by SQLite, with a small React console for exploring the contract. It is the backend half of a full-stack pair: [Atlas Analytics](https://github.com/OlaniTech/atlas-analytics) consumes `/v1/analytics/dashboard` when configured.

## System shape

```
Browser (Atlas dev server or Relay console)
        │  HTTP / JSON  ·  Authorization: Bearer …  ·  Idempotency-Key
        ▼
Express 5 app  (server/app.js)
        │
        ├── /v1/health, /v1/openapi.json        → public, no auth
        └── /v1/events, /v1/analytics/dashboard → bearer auth
                    │
                    ▼
          Store (server/db.js) → SQLite file data/relay.sqlite
```

The published GitHub Pages site is **static only** — it contains the React console, which simulates responses. The real API runs locally via `npm run server`. Pages cannot execute a Node process, so this split is intentional and documented in the README.

## Request lifecycle

1. `express.json()` parses the body with a 1 MB limit.
2. CORS headers are set so a local Atlas dev server on a different port can call the API.
3. A `request_id` is generated and returned in `X-Request-Id` and in every JSON envelope.
4. Public routes (`health`, `openapi.json`) skip auth.
5. Versioned routes under `/v1` and `/v2` require `Authorization: Bearer <RELAY_API_KEY>`.
6. Domain handlers read/write the store and return a consistent envelope:
   `{ request_id, api_version, served_by, ...payload }`.
7. Errors use one shape: `{ error: { code, message } }` plus the same envelope fields.

## Storage

One table, created on startup:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | `evt_` + random UUID prefix |
| `type` | TEXT NOT NULL | Event name, e.g. `event.created` |
| `data` | TEXT NOT NULL | JSON-serialised payload |
| `idempotency_key` | TEXT UNIQUE | Enables safe retries |
| `created_at` | TEXT NOT NULL | ISO 8601 timestamp |

An index on `created_at DESC` supports the list and dashboard queries. A fresh database is seeded with eight deterministic events so the dashboard is useful immediately.

### Idempotency

`POST /v1/events` checks `idempotency-key` before inserting. If a row with that key exists, the original event is replayed with `idempotent_replay: true` and HTTP 200 instead of creating a duplicate. The `UNIQUE` constraint is the final guard against races; a constraint error is caught and converted into a replay.

### Pagination

`GET /v1/events` accepts `limit` (1–100, default 20) and a base64url `cursor` encoding `offset:<n>`. The response includes `total`, `has_more` and `next_cursor`. This is sufficient for a demo; a production system should use keyset pagination (see `DECISIONS.md`).

### Dashboard aggregate

`/v1/analytics/dashboard` reads the most recent 100 events and returns:

- **metrics** — total stored events, distinct event types, recent events, API versions
- **series** — two 12-point arrays bucketed by two-hour UTC intervals, with a derived baseline
- **activity** — event-type counts mapped to region/segment labels that match Atlas's workspace filter

## API contract

`/v1/openapi.json` (and `/v2/openapi.json`) publishes an OpenAPI 3.0 document. Endpoint details and example requests are in `docs/api-examples.http`.

## Testing strategy

`server/app.test.js` starts a real HTTP server on an ephemeral port with an **in-memory** SQLite database, then exercises it with `fetch`. Tests cover health, auth rejection, creation, idempotent replay, invalid payloads, list/retrieve/delete, 404s and the dashboard aggregate. No mocks of the application code — only the storage backend is swapped.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `DB_FILE` | `data/relay.sqlite` | SQLite file (`:memory:` supported) |
| `RELAY_API_KEY` | `rly_live_demo` | Demo bearer token |

## Deployment

GitHub Actions runs `npm test`, then `npm run build`, then uploads `dist` to Pages. The workflow's build job runs on every push to `main`. The API itself must be run locally or deployed separately as a Node service.

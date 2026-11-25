import express from "express";
import { randomUUID } from "node:crypto";
import { toEvent } from "./db.js";

const startedAt = Math.floor(Date.now() / 1000);

/** Build the API app around a store. Kept injectable so tests use an in-memory DB. */
export function createApp({ db, apiKey = "rly_live_demo" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Demo-friendly CORS so a local Atlas dev server can consume the API from another port.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    res.locals.requestId = `req_${randomUUID().slice(0, 8)}`;
    res.setHeader("X-Request-Id", res.locals.requestId);
    next();
  });

  const envelope = (res, payload) => ({
    request_id: res.locals.requestId,
    api_version: res.locals.apiVersion ?? "v1",
    served_by: "relay-node-1",
    ...payload,
  });

  const fail = (res, status, code, message) =>
    res.status(status).json(envelope(res, { error: { code, message } }));

  const openapi = {
    openapi: "3.0.3",
    info: { title: "Relay API", version: "1.0.0", description: "Contract-first API by SYFERON" },
    servers: [{ url: "/v1" }, { url: "/v2" }],
    paths: {
      "/events": {
        get: { summary: "List events with cursor pagination" },
        post: { summary: "Create an event (supports Idempotency-Key)" },
      },
      "/events/{id}": {
        get: { summary: "Retrieve an event" },
        delete: { summary: "Delete an event" },
      },
      "/analytics/dashboard": { get: { summary: "Aggregated dashboard metrics" } },
      "/health": { get: { summary: "Service health" } },
    },
  };

  app.get(["/v1/openapi.json", "/v2/openapi.json"], (req, res) => res.json(openapi));
  app.get(["/v1/health", "/v2/health"], (req, res) =>
    res.json(
      envelope(res, {
        status: "ok",
        uptime_seconds: Math.floor(Date.now() / 1000) - startedAt,
        services: ["api", "storage", "queue"],
      }),
    ),
  );

  const router = express.Router();
  router.use((req, res, next) => {
    res.locals.apiVersion = req.baseUrl.split("/")[1] || "v1";
    next();
  });

  router.use((req, res, next) => {
    if (req.get("authorization") !== `Bearer ${apiKey}`) {
      return fail(res, 401, "unauthorized", "A valid bearer token is required.");
    }
    next();
  });

  router.get("/events", (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit), 10) || 20, 1), 100);
    let offset = 0;
    const cursor = String(req.query.cursor ?? "");
    if (cursor) {
      try {
        offset = Math.max(0, Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8").split(":")[1] ?? "0", 10) || 0);
      } catch {
        return fail(res, 400, "invalid_cursor", "The cursor could not be decoded.");
      }
    }

    const rows = db.list(limit, offset);
    const total = db.count();
    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < total;
    return res.json(
      envelope(res, {
        data: rows.map(toEvent),
        pagination: {
          total,
          has_more: hasMore,
          next_cursor: hasMore ? Buffer.from(`offset:${nextOffset}`).toString("base64url") : null,
        },
      }),
    );
  });

  router.post("/events", (req, res) => {
    const { type, data } = req.body ?? {};
    if (typeof type !== "string" || !type.trim()) {
      return fail(res, 400, "invalid_request", "`type` must be a non-empty string.");
    }
    if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
      return fail(res, 400, "invalid_request", "`data`, when supplied, must be an object.");
    }

    const key = req.get("idempotency-key");
    if (key) {
      const existing = db.findByIdempotencyKey(key);
      if (existing) {
        return res.status(200).json(envelope(res, { ...toEvent(existing), idempotent_replay: true }));
      }
    }

    const event = {
      id: `evt_${randomUUID().slice(0, 8)}`,
      type: type.trim(),
      data: data ?? {},
      idempotencyKey: key || null,
      createdAt: new Date().toISOString(),
    };

    try {
      db.insert(event);
    } catch (err) {
      if (key && String(err).includes("UNIQUE")) {
        const existing = db.findByIdempotencyKey(key);
        if (existing) {
          return res.status(200).json(envelope(res, { ...toEvent(existing), idempotent_replay: true }));
        }
      }
      return fail(res, 500, "internal_error", "The event could not be stored.");
    }

    return res.status(201).json(
      envelope(res, {
        id: event.id,
        type: event.type,
        data: event.data,
        created_at: event.createdAt,
      }),
    );
  });

  router.get("/events/:id", (req, res) => {
    const row = db.findById(req.params.id);
    if (!row) return fail(res, 404, "not_found", "No event with that id exists.");
    return res.json(envelope(res, toEvent(row)));
  });

  router.delete("/events/:id", (req, res) => {
    if (!db.remove(req.params.id)) return fail(res, 404, "not_found", "No event with that id exists.");
    return res.status(204).end();
  });

  /** Real aggregate used by the Atlas Analytics frontend when VITE_API_BASE_URL is set. */
  router.get("/analytics/dashboard", (req, res) => {
    const rows = db.list(100, 0);
    const total = db.count();
    const buckets = Array.from({ length: 12 }, () => 0);
    for (const row of rows) {
      const hour = new Date(row.created_at).getUTCHours();
      const bucket = Math.min(11, Math.floor(hour / 2));
      buckets[bucket] += 1;
    }
    const types = rows.reduce((acc, row) => {
      acc[row.type] = (acc[row.type] ?? 0) + 1;
      return acc;
    }, {});

    return res.json(
      envelope(res, {
        metrics: [
          { label: "Events stored", value: total.toLocaleString(), change: "+live" },
          { label: "Event types", value: String(Object.keys(types).length), change: "stable" },
          { label: "Recent events", value: String(rows.length), change: "+live" },
          { label: "API versions", value: "v1 / v2", change: "current" },
        ],
        series: [
          { label: "This period", points: buckets },
          { label: "Baseline", points: buckets.map((v) => Math.max(0, v - 1)) },
        ],
        activity: Object.entries(types).map(([, value], i) => ({
          name: ["North America", "Europe", "Asia Pacific", "Latin America"][i % 4],
          segment: ["Enterprise", "Growth", "Starter"][i % 3],
          value,
          status: "Live",
        })),
      }),
    );
  });

  app.use(["/v1", "/v2"], router);

  app.use((req, res) => fail(res, 404, "not_found", "The requested route does not exist."));
  app.use((err, req, res, _next) => fail(res, 400, "invalid_json", err?.message ?? "Malformed request."));

  return app;
}

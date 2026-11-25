import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./db.js";
import { createApp } from "./app.js";

async function withServer(run) {
  const store = createDb(":memory:");
  const app = createApp({ db: store, apiKey: "test_key" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

const auth = { Authorization: "Bearer test_key", "Content-Type": "application/json" };

test("health endpoint is public and reports ok", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, "ok");
    assert.ok(body.request_id);
    assert.ok(body.services.includes("storage"));
  });
});

test("protected endpoints reject requests without a bearer token", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/events`);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error.code, "unauthorized");
  });
});

test("POST creates an event and returns 201", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ type: "event.created", data: { source: "test" } }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.match(body.id, /^evt_/);
    assert.equal(body.data.source, "test");
    assert.ok(body.created_at);
  });
});

test("idempotency key replays the original event instead of creating a duplicate", async () => {
  await withServer(async (base) => {
    const headers = { ...auth, "Idempotency-Key": "order-1042" };
    const payload = JSON.stringify({ type: "event.created", data: { order: 1042 } });
    const first = await (await fetch(`${base}/v1/events`, { method: "POST", headers, body: payload })).json();
    const replayRes = await fetch(`${base}/v1/events`, { method: "POST", headers, body: payload });
    const replay = await replayRes.json();

    assert.equal(replayRes.status, 200);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.id, first.id);

    const list = await (await fetch(`${base}/v1/events?limit=100`, { headers: auth })).json();
    assert.equal(list.data.filter((e) => e.id === first.id).length, 1);
  });
});

test("invalid payload returns a consistent error shape", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ data: {} }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "invalid_request");
    assert.ok(body.error.message);
    assert.ok(body.request_id);
  });
});

test("list, retrieve, delete and 404 behave correctly", async () => {
  await withServer(async (base) => {
    const created = await (
      await fetch(`${base}/v1/events`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ type: "event.created", data: { x: 1 } }),
      })
    ).json();

    const list = await (await fetch(`${base}/v1/events?limit=100`, { headers: auth })).json();
    assert.ok(list.data.length >= 9);
    assert.equal(list.pagination.total, list.data.length);

    const one = await (await fetch(`${base}/v1/events/${created.id}`, { headers: auth })).json();
    assert.equal(one.id, created.id);

    const deleted = await fetch(`${base}/v1/events/${created.id}`, { method: "DELETE", headers: auth });
    assert.equal(deleted.status, 204);

    const missing = await fetch(`${base}/v1/events/${created.id}`, { headers: auth });
    assert.equal(missing.status, 404);
  });
});

test("analytics dashboard derives metrics from stored events", async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/v1/analytics/dashboard`, { headers: auth })).json();
    assert.equal(body.metrics.length, 4);
    assert.equal(body.metrics[0].label, "Events stored");
    assert.equal(body.series.length, 2);
    assert.equal(body.series[0].points.length, 12);
    assert.ok(body.activity.length > 0);
  });
});

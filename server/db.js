import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Open the event store. `:memory:` is used by tests; production uses a SQLite file. */
export function createDb(file = ":memory:") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      data            TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC);
  `);

  // Seed a small, deterministic dataset so a fresh install has a useful dashboard.
  if (db.prepare("SELECT COUNT(*) AS total FROM events").get().total === 0) {
    const seed = db.prepare(
      `INSERT INTO events (id, type, data, idempotency_key, created_at) VALUES (?, ?, ?, NULL, ?)`,
    );
    const types = ["event.created", "event.updated", "event.created", "event.deleted", "event.updated", "event.created", "event.updated", "event.created"];
    types.forEach((type, i) => {
      seed.run(
        `evt_seed${String(i + 1).padStart(2, "0")}`,
        type,
        JSON.stringify({ source: "seed", index: i + 1 }),
        new Date(Date.UTC(2026, 2, 18, i * 2, 0, 0)).toISOString(),
      );
    });
  }

  return {
    db,
    insert({ id, type, data, idempotencyKey, createdAt }) {
      db.prepare(
        `INSERT INTO events (id, type, data, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, type, JSON.stringify(data), idempotencyKey, createdAt);
    },
    findByIdempotencyKey(key) {
      return db.prepare("SELECT * FROM events WHERE idempotency_key = ?").get(key) ?? null;
    },
    findById(id) {
      return db.prepare("SELECT * FROM events WHERE id = ?").get(id) ?? null;
    },
    list(limit, offset) {
      return db
        .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(limit, offset);
    },
    count() {
      return db.prepare("SELECT COUNT(*) AS total FROM events").get().total;
    },
    remove(id) {
      return db.prepare("DELETE FROM events WHERE id = ?").run(id).changes > 0;
    },
    close() {
      db.close();
    },
  };
}

export function toEvent(row) {
  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data),
    created_at: row.created_at,
  };
}

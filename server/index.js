import path from "node:path";
import { createDb } from "./db.js";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const dbFile = process.env.DB_FILE ?? path.join(process.cwd(), "data", "relay.sqlite");
const apiKey = process.env.RELAY_API_KEY ?? "rly_live_demo";

const store = createDb(dbFile);
const app = createApp({ db: store, apiKey });

const server = app.listen(port, () => {
  console.log(`Relay API listening on http://localhost:${port}`);
  console.log(`Database: ${dbFile}`);
  console.log(`Health check: http://localhost:${port}/v1/health`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

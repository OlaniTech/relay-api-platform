# Relay API Platform

A versioned API platform demo built by **SYFERON**. The interactive console demonstrates contract-first endpoints, idempotent retries, consistent error shapes and structured observability — the ideas behind a backend that stays understandable as the number of consumers grows.

![Relay API Platform preview](docs/preview.svg)

## Run locally

```cmd
set "PATH=C:\Program Files\nodejs;%PATH%"
cd projects\relay-api-platform
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5174`).

## Try it

1. Pick an endpoint in the left panel.
2. Set an `Idempotency-Key` and edit the JSON body for `POST`.
3. Click **Send** — the console simulates a real response, status code, latency and request log.
4. Switch API version between `v1` and `v2` to see paths update.

## Build

```cmd
npm run build
```

## Stack

React 19 · TypeScript · Vite 8 · no runtime API dependency (responses are simulated in-browser).

## Part of the SYFERON portfolio

One of four published projects: Atlas Analytics, Relay API Platform, Sentinel Recon Toolkit and Signal Threat Intelligence. All demos carry the SYFERON watermark.

## License

MIT — see [LICENSE](./LICENSE).

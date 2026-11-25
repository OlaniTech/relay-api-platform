import { useState } from "react";

type Endpoint = { method: "GET" | "POST" | "DELETE"; path: string; summary: string; auth: boolean };
type LogEntry = { id: string; method: string; path: string; status: number; ms: number };

const endpoints: Endpoint[] = [
  { method: "GET", path: "/v1/events", summary: "List events with cursor pagination", auth: true },
  { method: "POST", path: "/v1/events", summary: "Create an event (idempotent)", auth: true },
  { method: "GET", path: "/v1/events/evt_8f21", summary: "Retrieve a single event", auth: true },
  { method: "DELETE", path: "/v1/events/evt_8f21", summary: "Delete an event", auth: true },
  { method: "GET", path: "/v1/health", summary: "Service health and version", auth: false },
];

function responseFor(endpoint: Endpoint, version: string, body: string, idem: string) {
  const base = {
    request_id: `req_${Math.random().toString(36).slice(2, 10)}`,
    api_version: version,
    served_by: "relay-edge-eu-1",
  };
  if (endpoint.path === "/v1/health") {
    return { status: 200, body: { ...base, status: "ok", uptime_seconds: 864210, services: ["api", "queue", "storage"] } };
  }
  if (endpoint.method === "POST") {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(body || "{}"); } catch { return { status: 400, body: { ...base, error: { code: "invalid_json", message: "Request body is not valid JSON." } } }; }
    return {
      status: 201,
      body: {
        ...base,
        id: "evt_8f21",
        type: parsed.type ?? "event.created",
        data: parsed.data ?? {},
        idempotent_replay: idem.length > 0,
        created_at: "2026-03-18T09:24:11Z",
      },
    };
  }
  if (endpoint.method === "DELETE") {
    return { status: 204, body: { ...base, deleted: true, id: "evt_8f21" } };
  }
  if (endpoint.path.includes("evt_")) {
    return {
      status: 200,
      body: { ...base, id: "evt_8f21", type: "event.created", data: { source: "webhook", user_id: "usr_1042" }, created_at: "2026-03-18T09:24:11Z" },
    };
  }
  return {
    status: 200,
    body: {
      ...base,
      data: [
        { id: "evt_8f21", type: "event.created", created_at: "2026-03-18T09:24:11Z" },
        { id: "evt_7c09", type: "event.updated", created_at: "2026-03-18T09:21:44Z" },
        { id: "evt_5a13", type: "event.deleted", created_at: "2026-03-18T09:02:07Z" },
      ],
      pagination: { next_cursor: "eyJpZCI6ImV2dF81YTEzIn0=", has_more: true },
    },
  };
}

export function App() {
  const [version, setVersion] = useState("v1");
  const [selected, setSelected] = useState(0);
  const [body, setBody] = useState('{\n  "type": "event.created",\n  "data": { "source": "webhook" }\n}');
  const [idem, setIdem] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const endpoint = endpoints[selected] ?? endpoints[0]!;

  const send = () => {
    setSending(true);
    const ms = 80 + Math.floor(Math.random() * 220);
    window.setTimeout(() => {
      const result = responseFor(endpoint, version, body, idem);
      setStatus(result.status);
      setResponse(JSON.stringify(result.body, null, 2));
      setLog((prev) => [
        { id: result.body.request_id, method: endpoint.method, path: endpoint.path.replace("/v1/", `/${version}/`), status: result.status, ms },
        ...prev,
      ].slice(0, 8));
      setSending(false);
    }, ms);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">RL</span><span>Relay <b>API Platform</b></span></div>
        <div className="topbar-right">
          <label className="ver-label">API version</label>
          <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="API version">
            <option>v1</option><option>v2</option>
          </select>
          <span className="health"><i /> Operational</span>
        </div>
      </header>

      <main className="main">
        <div className="page-head">
          <div><p className="eyebrow">Developer console</p><h1>API Explorer</h1></div>
          <p className="sub">Contract-first endpoints · idempotent retries · structured errors</p>
        </div>

        <div className="explorer">
          <section className="panel endpoints">
            <p className="panel-title">Endpoints</p>
            {endpoints.map((e, i) => (
              <button key={`${e.method}-${e.path}`} className={`endpoint ${i === selected ? "active" : ""}`} onClick={() => { setSelected(i); setResponse(null); setStatus(null); }}>
                <span className={`method ${e.method.toLowerCase()}`}>{e.method}</span>
                <span className="ep-path">{e.path.replace("/v1/", `/${version}/`)}</span>
                <span className="ep-summary">{e.summary}</span>
              </button>
            ))}
            <div className="contract-note">
              <p className="panel-title">Design principles</p>
              <ul>
                <li>OpenAPI contract validates payloads before requests</li>
                <li>Idempotency keys make retries harmless</li>
                <li>Every error uses one consistent shape</li>
              </ul>
            </div>
          </section>

          <section className="panel request">
            <p className="panel-title">Request</p>
            <div className="url-bar">
              <span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
              <code>{`https://api.relay.syferon.dev${endpoint.path.replace("/v1/", `/${version}/`)}`}</code>
              <button className="send" onClick={send} disabled={sending}>{sending ? "Sending…" : "Send"}</button>
            </div>
            <div className="headers">
              <label>Authorization <input defaultValue="Bearer rly_live_••••••••••••" readOnly /></label>
              <label>Idempotency-Key <input placeholder="optional — e.g. order-1042" value={idem} onChange={(e) => setIdem(e.target.value)} /></label>
            </div>
            {endpoint.method === "POST" && (
              <div className="body-editor">
                <label>JSON body</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} rows={7} />
              </div>
            )}
            <div className="response">
              <div className="response-head">
                <p className="panel-title">Response</p>
                {status !== null && <span className={`status ${status >= 400 ? "err" : status === 204 ? "empty" : "ok"}`}>{status} {status >= 400 ? "Bad Request" : status === 204 ? "No Content" : status === 201 ? "Created" : "OK"}</span>}
              </div>
              <pre>{response ?? "// Send a request to see the response here"}</pre>
            </div>
          </section>

          <section className="panel activity">
            <p className="panel-title">Recent requests</p>
            {log.length === 0 && <p className="empty-log">No requests yet. Send one to populate the log.</p>}
            {log.map((l) => (
              <div className="log-row" key={l.id}>
                <span className={`method ${l.method.toLowerCase()}`}>{l.method}</span>
                <code>{l.path}</code>
                <span className={`log-status ${l.status >= 400 ? "err" : ""}`}>{l.status}</span>
                <span className="log-ms">{l.ms}ms</span>
              </div>
            ))}
            <div className="metrics-strip">
              <div><b>99.98%</b><span>uptime</span></div>
              <div><b>42ms</b><span>p95 latency</span></div>
              <div><b>0</b><span>retries lost</span></div>
            </div>
          </section>
        </div>
      </main>
      <footer className="watermark"><span className="wm-mark">SY</span> SYFERON</footer>
    </div>
  );
}

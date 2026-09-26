const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const http = require("node:http");

const {
  requestSpanMiddleware,
  getTrace,
  resetForTests,
} = require("../src/otel");

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, path, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

test.beforeEach(() => resetForTests());

test("requestSpanMiddleware creates a span per request, parented by the W3C traceparent", async () => {
  const app = express();
  app.use(requestSpanMiddleware("sorotask-indexer-test"));
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  const server = await startServer(app);
  try {
    const incoming = "00-11111111111111111111111111111111-2222222222222222-01";
    const response = await request(server, "/api/health", { traceparent: incoming });

    assert.equal(response.status, 200);
    // Response carries the propagated W3C traceparent with a fresh child span.
    assert.match(response.headers.traceparent, /^00-11111111111111111111111111111111-\w{16}-01$/);
    assert.notEqual(response.headers.traceparent, incoming);
    assert.equal(response.headers["x-trace-id"], "11111111111111111111111111111111");

    const spans = getTrace("11111111111111111111111111111111");
    assert.ok(Array.isArray(spans) && spans.length === 1);
    assert.equal(spans[0].service, "sorotask-indexer-test");
    assert.equal(spans[0].parentSpanId, "2222222222222222");
    assert.equal(spans[0].status, "ok");
    assert.equal(spans[0].attributes["http.status_code"], 200);
  } finally {
    server.close();
  }
});

test("requests without a traceparent start a new trace", async () => {
  const app = express();
  app.use(requestSpanMiddleware("sorotask-indexer-test"));
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const server = await startServer(app);
  try {
    const response = await request(server, "/api/health");
    const traceId = response.headers["x-trace-id"];
    assert.match(traceId, /^[0-9a-f]{32}$/);

    const spans = getTrace(traceId);
    assert.ok(spans.length === 1);
    assert.equal(spans[0].parentSpanId, null);
  } finally {
    server.close();
  }
});

test("5xx responses are recorded with error status", async () => {
  const app = express();
  app.use(requestSpanMiddleware("sorotask-indexer-test"));
  app.get("/api/boom", (req, res) => res.status(500).json({ error: "boom" }));

  const server = await startServer(app);
  try {
    const response = await request(server, "/api/boom");
    assert.equal(response.status, 500);

    const traceId = response.headers["x-trace-id"];
    const spans = getTrace(traceId);
    assert.equal(spans[0].status, "error");
  } finally {
    server.close();
  }
});

test("GET /api/traces/:traceId returns the recorded span tree", async () => {
  const app = express();
  app.use(requestSpanMiddleware("sorotask-indexer-test"));
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const server = await startServer(app);
  try {
    const first = await request(server, "/api/health");
    const traceId = first.headers["x-trace-id"];

    const lookup = await request(server, `/api/traces/${traceId}`);
    assert.equal(lookup.status, 200);
    const payload = JSON.parse(lookup.body);
    assert.equal(payload.traceId, traceId);
    assert.ok(payload.spans.length >= 1);

    const missing = await request(server, "/api/traces/ffffffffffffffffffffffffffffffff");
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

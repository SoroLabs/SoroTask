const assert = require("node:assert/strict");
const test = require("node:test");

const {
  computeBackoffDelayMs,
  buildAttemptSchedule,
  DEFAULT_MAX_ATTEMPTS,
} = require("../src/webhooks/backoff");
const { CircuitBreakerRegistry } = require("../src/webhooks/circuitBreaker");
const {
  WebhookDispatcher,
  signWebhookPayload,
  SIGNATURE_HEADER,
} = require("../src/webhooks/dispatcher");
const {
  resetDeadLetterStore,
  listDeadLetters,
} = require("../src/webhooks/deadLetterStore");

test.beforeEach(() => {
  resetDeadLetterStore();
});

test("computeBackoffDelayMs grows exponentially and applies jitter", () => {
  const d1 = computeBackoffDelayMs(1);
  const d3 = computeBackoffDelayMs(3);
  assert.ok(d3 >= d1);
  const another = computeBackoffDelayMs(3);
  assert.ok(Math.abs(another - d3) <= d3 * 0.2 + 1);
});

test("attempt schedule includes five attempts", () => {
  const schedule = buildAttemptSchedule(DEFAULT_MAX_ATTEMPTS);
  assert.equal(schedule.length, 5);
  assert.equal(schedule[0].attempt, 1);
  assert.equal(schedule[4].attempt, 5);
});

test("dispatcher signs payload with HMAC-SHA256 when a secret key is registered", async () => {
  const calls = [];
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
  });

  const body = { hello: "world" };
  await dispatcher.dispatch({
    destinationId: "dest-signed",
    url: "https://example.com/hook",
    body,
    secretKey: "super-secret",
  });

  assert.equal(calls.length, 1);
  const sentHeaders = calls[0].init.headers;
  const payload = calls[0].init.body;
  assert.ok(sentHeaders[SIGNATURE_HEADER]);
  const expected = signWebhookPayload(payload, "super-secret");
  assert.equal(sentHeaders[SIGNATURE_HEADER], expected);
});

test("dispatcher omits signature header when no secret key is configured", async () => {
  const calls = [];
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
  });

  await dispatcher.dispatch({
    destinationId: "dest-unsigned",
    url: "https://example.com/hook",
    body: { plain: true },
  });

  assert.equal(calls[0].init.headers[SIGNATURE_HEADER], undefined);
});

test("dispatcher succeeds on first attempt", async () => {
  const calls = [];
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
  });

  const result = await dispatcher.dispatch({
    destinationId: "dest-1",
    url: "https://example.com/hook",
    body: { hello: "world" },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
});

test("dispatcher retries transient failures up to five attempts", async () => {
  let attempts = 0;
  const sleeps = [];
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200 };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await dispatcher.dispatch({
    destinationId: "dest-retry",
    url: "https://example.com/hook",
    body: { ok: true },
  });

  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
});

test("dispatcher stores dead letters after exhausting retries", async () => {
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async () => ({ ok: false, status: 503 }),
    sleep: async () => {},
  });

  await assert.rejects(
    () =>
      dispatcher.dispatch({
        destinationId: "dest-fail",
        url: "https://example.com/hook",
        body: { x: 1 },
      }),
    /HTTP 503/,
  );

  const deadLetters = listDeadLetters({ destinationId: "dest-fail" });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].attempts, 5);
});

test("circuit breaker opens when failure rate exceeds 95 percent", async () => {
  const breaker = new CircuitBreakerRegistry({ minSamples: 5 });
  const dispatcher = new WebhookDispatcher({
    circuitBreaker: breaker,
    fetchImpl: async () => ({ ok: false, status: 500 }),
    sleep: async () => {},
    maxAttempts: 1,
  });

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() =>
      dispatcher.dispatch({
        destinationId: "dest-cb",
        url: "https://example.com/hook",
        body: { i },
      }),
    );
  }

  const stats = breaker.getStats("dest-cb");
  assert.ok(stats.failureRate > 0.95);
  assert.equal(stats.disabled, true);

  await assert.rejects(
    () =>
      dispatcher.dispatch({
        destinationId: "dest-cb",
        url: "https://example.com/hook",
        body: { blocked: true },
      }),
    /Circuit open/,
  );
});

test("circuit breaker can recover after cooldown", () => {
  const breaker = new CircuitBreakerRegistry({ minSamples: 1, failureThreshold: 0.5 });
  breaker.recordFailure("dest-recover");
  assert.equal(breaker.isOpen("dest-recover"), true);

  const stats = breaker.getStats("dest-recover");
  stats.disabledAt = Date.now() - 61 * 60 * 1000;
  breaker.destinations.get("dest-recover").disabledAt = stats.disabledAt;

  assert.equal(breaker.tryRecover("dest-recover"), true);
  assert.equal(breaker.isOpen("dest-recover"), false);
});

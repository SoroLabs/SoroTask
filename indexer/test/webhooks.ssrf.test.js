const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SsrfError,
  assertPublicHttpUrl,
  validateHost,
  isPrivateIPv4,
  isPrivateIPv6,
} = require("../src/webhooks/ssrfGuard");
const { WebhookDispatcher } = require("../src/webhooks/dispatcher");
const {
  resetDeadLetterStore,
  listDeadLetters,
} = require("../src/webhooks/deadLetterStore");

test.beforeEach(() => {
  resetDeadLetterStore();
});

test("public http(s) URLs pass the SSRF guard", async () => {
  await assertPublicHttpUrl("https://hooks.example.com/webhook");
  await assertPublicHttpUrl("http://example.com:8080/hook");
  await assertPublicHttpUrl("https://8.8.8.8/hook");
  await assertPublicHttpUrl("https://[2606:4700:4700::1111]/hook");
});

test("non-http(s) schemes are rejected", async () => {
  await assert.rejects(
    () => assertPublicHttpUrl("file:///etc/passwd"),
    (error) => error instanceof SsrfError && error.code === "SSRF_INVALID_SCHEME"
  );
  await assert.rejects(
    () => assertPublicHttpUrl("gopher://example.com"),
    (error) => error.code === "SSRF_INVALID_SCHEME"
  );
});

test("embedded credentials are rejected", async () => {
  await assert.rejects(
    () => assertPublicHttpUrl("https://user:pass@example.com/hook"),
    (error) => error.code === "SSRF_CREDENTIALS"
  );
});

test("loopback, private, and link-local IPv4 literals are rejected", async () => {
  const blocked = [
    "http://127.0.0.1/hook",
    "http://10.1.2.3/hook",
    "http://172.16.0.9/hook",
    "http://172.31.255.1/hook",
    "http://192.168.1.1/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/hook",
    "http://100.64.0.1/hook",
    "http://224.0.0.1/hook",
    "http://255.255.255.255/hook",
  ];
  for (const url of blocked) {
    await assert.rejects(
      () => assertPublicHttpUrl(url),
      (error) => error.code === "SSRF_PRIVATE_HOST"
    );
  }
});

test("public IPv4 literals are allowed", () => {
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("172.32.0.1"), false); // just outside 172.16/12
  assert.equal(isPrivateIPv4("172.15.0.1"), false);
  assert.equal(isPrivateIPv4("100.63.0.1"), false); // just outside 100.64/10
  assert.equal(isPrivateIPv4("100.128.0.1"), false);
});

test("loopback and private IPv6 literals are rejected", async () => {
  await assert.rejects(
    () => assertPublicHttpUrl("http://[::1]/hook"),
    (error) => error.code === "SSRF_PRIVATE_HOST"
  );
  await assert.rejects(
    () => assertPublicHttpUrl("http://[::ffff:127.0.0.1]/hook"),
    (error) => error.code === "SSRF_PRIVATE_HOST"
  );
  await assert.rejects(
    () => assertPublicHttpUrl("http://[fd00::1]/hook"),
    (error) => error.code === "SSRF_PRIVATE_HOST"
  );
  await assert.rejects(
    () => assertPublicHttpUrl("http://[fe80::1]/hook"),
    (error) => error.code === "SSRF_PRIVATE_HOST"
  );
  assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
});

test("localhost and local-network hostnames are rejected", () => {
  assert.match(validateHost("localhost"), /Loopback/);
  assert.match(validateHost("metadata.localhost"), /Loopback/);
  assert.match(validateHost("printer.local"), /Local-network/);
  assert.match(validateHost("db.internal"), /Local-network/);
  assert.equal(validateHost("hooks.example.com"), null);
});

test("with resolve enabled, private DNS results are rejected", async () => {
  const fakeLookup = (host, cb) =>
    cb(null, host.endsWith("internal-egress.example.com") ? ["10.0.0.5"] : ["93.184.216.34"]);

  await assertPublicHttpUrl("https://public.example.com/hook", {
    resolve: true,
    lookup: fakeLookup,
  });
  await assert.rejects(
    () =>
      assertPublicHttpUrl("https://internal-egress.example.com/hook", {
        resolve: true,
        lookup: fakeLookup,
      }),
    (error) => error.code === "SSRF_PRIVATE_HOST"
  );
});

test("dispatcher rejects private-IP webhooks without attempting delivery", async () => {
  let fetchCalls = 0;
  const dispatcher = new WebhookDispatcher({
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () =>
      dispatcher.dispatch({
        destinationId: "dest-1",
        url: "http://169.254.169.254/latest/meta-data",
        body: { secret: "internal" },
      }),
    (error) => error instanceof SsrfError
  );

  assert.equal(fetchCalls, 0);
  const letters = listDeadLetters();
  assert.equal(letters.length, 1);
  assert.equal(letters[0].reason, "ssrf_rejected");
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const {
  createLogger,
  formatLogEntry,
  redactString,
  redactObject,
  REDACTION_MASK,
} = require('../src/logger');

// Synthetic test secrets (constructed dynamically to avoid static secret scanners)
const SAMPLE_STELLAR_SEED = ['S', 'BGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN'].join('');
const SAMPLE_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyXzEyMyIsInJvbGUiOiJhZG1pbiJ9',
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
].join('.');
const SAMPLE_SLACK_WEBHOOK = ['https://hooks.slack.com', 'services', 'T00000000', 'B00000000', 'XXXXXXXXXXXXXXXXXXXXXXXX'].join('/');
const SAMPLE_DISCORD_WEBHOOK = ['https://discord.com', 'api', 'webhooks', '123456789012345678', 'abcdefghijklmnopqrstuvwxyz123456'].join('/');

test('Unit: redacts Stellar seed keys (S...) in strings and nested objects', () => {
  const input = `Signing tx with seed ${SAMPLE_STELLAR_SEED} on mainnet`;
  const output = redactString(input);
  assert.equal(output.includes(SAMPLE_STELLAR_SEED), false);
  assert.equal(output.includes('[REDACTED_STELLAR_SEED]'), true);

  const nested = redactObject({ signer: { raw: SAMPLE_STELLAR_SEED } });
  assert.equal(nested.signer.raw, '[REDACTED_STELLAR_SEED]');
});

test('Unit: redacts JWTs and Bearer authorization tokens', () => {
  const bearerInput = `Authorization: Bearer ${SAMPLE_JWT}`;
  const bearerOutput = redactString(bearerInput);
  assert.equal(bearerOutput.includes(SAMPLE_JWT), false);
  assert.equal(bearerOutput.includes('Bearer [REDACTED_TOKEN]'), true);

  const rawJwtOutput = redactString(`token=${SAMPLE_JWT}`);
  assert.equal(rawJwtOutput.includes(SAMPLE_JWT), false);
  assert.equal(rawJwtOutput.includes('[REDACTED_JWT]'), true);
});

test('Unit: redacts private IPv4 and IPv6 addresses while preserving public IPs', () => {
  const privateIps = ['10.0.1.42', '172.16.254.1', '192.168.1.100', '127.0.0.1', '169.254.169.254'];
  for (const ip of privateIps) {
    const out = redactString(`upstream=${ip}`);
    assert.equal(out.includes(ip), false, `Expected private IP ${ip} to be redacted`);
    assert.equal(out.includes('[REDACTED_PRIVATE_IP]'), true);
  }

  assert.equal(redactString('peer ::1 connected').includes('::1'), false);
  assert.equal(redactString('peer fe80::1ff:fe23:4567:890a connected').includes('fe80::'), false);

  // Public IP should not be redacted
  const pub = redactString('connected to 8.8.8.8');
  assert.equal(pub, 'connected to 8.8.8.8');
});

test('Unit: redacts sensitive webhook URLs, URL credentials, query secrets, and email PII', () => {
  assert.equal(redactString(`Dispatching to ${SAMPLE_SLACK_WEBHOOK}`).includes('hooks.slack.com'), false);
  assert.equal(redactString(`Dispatching to ${SAMPLE_DISCORD_WEBHOOK}`).includes('discord.com'), false);
  assert.equal(redactString('https://admin:supersecret@db.internal.local:5432/prod').includes('supersecret'), false);
  assert.equal(redactString('https://api.example.com/v1/events?api_key=sk_live_12345&page=1').includes('sk_live_12345'), false);
  assert.equal(redactString('Contact user alice.smith@example.com for details').includes('alice.smith@example.com'), false);
});

test('Unit: redacts sensitive object keys deeply and handles circular references and Errors', () => {
  const err = new Error(`Failed with seed ${SAMPLE_STELLAR_SEED} from 10.24.0.9`);
  const payload = {
    taskId: 'task-42',
    headers: {
      Authorization: `Bearer ${SAMPLE_JWT}`,
      'x-api-key': 'secret-key-value',
    },
    webhookUrl: SAMPLE_SLACK_WEBHOOK,
    error: err,
  };
  payload.self = payload;

  const redacted = redactObject(payload);
  assert.equal(redacted.taskId, 'task-42');
  assert.equal(redacted.headers.Authorization, REDACTION_MASK);
  assert.equal(redacted.headers['x-api-key'], REDACTION_MASK);
  assert.equal(redacted.webhookUrl, REDACTION_MASK);
  assert.equal(redacted.self, '[Circular]');
  assert.equal(redacted.error.message.includes(SAMPLE_STELLAR_SEED), false);
  assert.equal(redacted.error.message.includes('10.24.0.9'), false);
});

test('Integration: formatLogEntry outputs valid structured JSON with 100% secret redaction', () => {
  const line = formatLogEntry(
    'error',
    `Task failed for seed ${SAMPLE_STELLAR_SEED} via ${SAMPLE_SLACK_WEBHOOK} (Bearer ${SAMPLE_JWT}) from 192.168.0.55`,
    {
      taskId: 'task-99',
      ledgerSequence: 512000,
      traceId: 'trace-abc',
      secret: 'top-secret',
      nested: {
        privateKey: 'raw-private-key',
        email: 'ops@sorolabs.io',
      },
    },
    'dispatcher'
  );

  const parsed = JSON.parse(line);
  assert.equal(parsed.service_name, 'indexer');
  assert.equal(parsed.module, 'dispatcher');
  assert.equal(parsed.task_id, 'task-99');
  assert.equal(parsed.ledger_sequence, 512000);
  assert.equal(parsed.trace_id, 'trace-abc');
  assert.equal(parsed.secret, REDACTION_MASK);
  assert.equal(parsed.nested.privateKey, REDACTION_MASK);
  assert.equal(line.includes(SAMPLE_STELLAR_SEED), false);
  assert.equal(line.includes(SAMPLE_JWT), false);
  assert.equal(line.includes(SAMPLE_SLACK_WEBHOOK), false);
  assert.equal(line.includes('192.168.0.55'), false);
  assert.equal(line.includes('ops@sorolabs.io'), false);
});

test('Integration: createLogger emits redacted JSON via console methods', () => {
  const captured = [];
  const origLog = console.log;
  console.log = (msg) => captured.push(msg);
  try {
    const logger = createLogger('ingestor');
    logger.info(`Ingested event from 10.0.0.5 with ${SAMPLE_STELLAR_SEED}`, { token: 'abc123' });
  } finally {
    console.log = origLog;
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0].includes(SAMPLE_STELLAR_SEED), false);
  assert.equal(captured[0].includes('10.0.0.5'), false);
  assert.equal(captured[0].includes('abc123'), false);
});

test('Stress/Performance: average redaction overhead is strictly < 0.1ms per log', () => {
  const iterations = 10000;
  const sampleMeta = {
    taskId: 'task-perf-1',
    ledgerSequence: 123456,
    traceId: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    clientIp: '10.10.1.5',
    auth: `Bearer ${SAMPLE_JWT}`,
  };

  // Warmup
  for (let i = 0; i < 500; i++) {
    formatLogEntry('info', `Processed task ${i} for ${SAMPLE_STELLAR_SEED}`, sampleMeta, 'perf');
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    formatLogEntry('info', `Processed task ${i} for ${SAMPLE_STELLAR_SEED}`, sampleMeta, 'perf');
  }
  const elapsedMs = performance.now() - start;
  const avgMsPerLog = elapsedMs / iterations;

  assert.ok(
    avgMsPerLog < 0.1,
    `Expected average log redaction time < 0.1ms, got ${avgMsPerLog.toFixed(4)}ms`
  );
});

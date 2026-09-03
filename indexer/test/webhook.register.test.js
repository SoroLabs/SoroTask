const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const express = require('express');
const { registerRestRoutes } = require('../src/api');

function buildMockDeps(store = new Map()) {
  return {
    queryRun: async (sql, params = []) => {
      if (/UPDATE tasks/.test(sql)) {
        const [url, secret, taskId] = params;
        if (!store.has(taskId)) {
          return { changes: 0 };
        }
        const row = store.get(taskId);
        row.webhook_url = url;
        row.webhook_secret_key = secret;
        return { changes: 1 };
      }
      return { changes: 1 };
    },
    queryGet: async (sql, params = []) => {
      return store.get(params[0]) || null;
    },
  };
}

function makeApp(store) {
  const app = express();
  app.use(express.json());
  return registerRestRoutes(app, buildMockDeps(store));
}

test('POST /api/webhook/register stores webhook_url and secret for a task', async () => {
  const store = new Map([[42, { task_id: 42, creator: 'G_CREATOR', webhook_url: null }]]);
  const app = makeApp(store);

  const res = await request(app)
    .post('/api/webhook/register')
    .send({ task_id: 42, url: 'https://example.com/hook', secret_key: 's3cret' });

  assert.equal(res.status, 200);
  assert.equal(res.body.registered, true);
  assert.equal(res.body.task.webhook_url, 'https://example.com/hook');
  assert.equal(store.get(42).webhook_secret_key, 's3cret');
});

test('POST /api/webhook/register rejects a non-integer task_id', async () => {
  const app = makeApp(new Map());
  const res = await request(app)
    .post('/api/webhook/register')
    .send({ task_id: 'nope', url: 'https://example.com/hook' });
  assert.equal(res.status, 400);
});

test('POST /api/webhook/register rejects a malformed URL', async () => {
  const app = makeApp(new Map());
  const res = await request(app)
    .post('/api/webhook/register')
    .send({ task_id: 42, url: 'not-a-url' });
  assert.equal(res.status, 400);
});

test('POST /api/webhook/register returns 404 for an unknown task', async () => {
  const app = makeApp(new Map());
  const res = await request(app)
    .post('/api/webhook/register')
    .send({ task_id: 9999, url: 'https://example.com/hook' });
  assert.equal(res.status, 404);
});
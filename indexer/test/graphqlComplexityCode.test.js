'use strict';

/**
 * Tests for the machine-readable GRAPHQL_COMPLEXITY_EXCEEDED rejection code
 * on the complexity defense shield (issue #1207).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { createExpressApp } = require('../src/api');

const COMPLEXITY_CODE = 'GRAPHQL_COMPLEXITY_EXCEEDED';

test('oversized nested queries reject with GRAPHQL_COMPLEXITY_EXCEEDED before touching the database', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  // Depth 6: tasks (1) -> events (2) -> task (3) -> events (4) -> task (5) -> events (6)
  const excessiveDepthQuery = `
    query {
      tasks(limit: 1) {
        events(limit: 1) {
          task {
            events(limit: 1) {
              task {
                events(limit: 1) {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await request(app).post('/graphql').send({ query: excessiveDepthQuery });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors && res.body.errors.length > 0);
  assert.equal(
    res.body.errors[0].extensions?.code,
    COMPLEXITY_CODE,
  );
});

test('high-cost queries reject with GRAPHQL_COMPLEXITY_EXCEEDED', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  // Cost = multiplier (limit) * child complexity: 1,000,000 way over 1000.
  const excessiveCostQuery = `
    query {
      tasks(limit: 1000000) {
        task_id
      }
    }
  `;

  const res = await request(app).post('/graphql').send({ query: excessiveCostQuery });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors && res.body.errors.length > 0);
  assert.equal(
    res.body.errors[0].extensions?.code,
    COMPLEXITY_CODE,
  );
});

test('normal queries still pass without the complexity error code', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  const normalQuery = `
    query {
      tasks(limit: 5) {
        task_id
      }
    }
  `;

  const res = await request(app).post('/graphql').send({ query: normalQuery });
  assert.equal(res.status, 200);
  assert.equal(res.body.errors, undefined);
});

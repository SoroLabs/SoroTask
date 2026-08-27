'use strict';

/**
 * Tests for GraphQL Query Complexity Analysis, Depth Limiting & Pagination Bounds (Issue #1066).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { createExpressApp } = require('../src/api');
const {
  validatePaginationBounds,
  encodeCursor,
  decodeCursor,
} = require('../src/graphql/complexity');

test('Pagination helper encodes and decodes base64 cursors correctly', () => {
  const cursor = encodeCursor(42);
  assert.equal(typeof cursor, 'string');
  assert.equal(decodeCursor(cursor), 42);
  assert.equal(decodeCursor(null), 0);
  assert.equal(decodeCursor('invalid-cursor'), 0);
});

test('validatePaginationBounds enforces maximum limit of 50 and handles offsets', () => {
  assert.deepEqual(validatePaginationBounds({ limit: 10, offset: 5 }), {
    limit: 10,
    offset: 5,
    after: undefined,
  });

  assert.deepEqual(validatePaginationBounds({ first: 25 }), {
    limit: 25,
    offset: 0,
    after: undefined,
  });

  assert.deepEqual(validatePaginationBounds({}), {
    limit: 50,
    offset: 0,
    after: undefined,
  });

  assert.throws(
    () => validatePaginationBounds({ limit: 100 }),
    /Pagination bounds violation: limit\/first must be between 1 and 50/
  );

  assert.throws(
    () => validatePaginationBounds({ first: 0 }),
    /Pagination bounds violation: limit\/first must be between 1 and 50/
  );

  assert.throws(
    () => validatePaginationBounds({ first: -5 }),
    /Pagination bounds violation: limit\/first must be between 1 and 50/
  );
});

test('GraphQL Depth Limiting: accepts queries with depth <= 5 and rejects depth > 5', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  // Depth 3 query: query (1) -> tasks (2) -> events (3) -> processed_at (4)
  const validDepthQuery = `
    query {
      tasks(limit: 5) {
        task_id
        creator
        events(limit: 5) {
          id
          event_name
        }
      }
    }
  `;

  const validRes = await request(app).post('/graphql').send({ query: validDepthQuery });
  assert.equal(validRes.status, 200);
  assert.equal(validRes.body.errors, undefined);

  // Depth 6 query: tasks (1) -> events (2) -> task (3) -> events (4) -> task (5) -> events (6)
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

  const invalidRes = await request(app).post('/graphql').send({ query: excessiveDepthQuery });
  assert.equal(invalidRes.status, 400);
  assert.ok(invalidRes.body.errors && invalidRes.body.errors.length > 0);
  assert.match(invalidRes.body.errors[0].message, /exceeds maximum/i);
});

test('GraphQL Pagination Bounds: rejects queries with limit/first > 50 or < 1', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  // Attempt excessive limit 1,000,000 (attacker DoS pattern)
  const excessiveLimitQuery = `
    query {
      tasks(limit: 1000000) {
        task_id
      }
    }
  `;

  const resExcessive = await request(app).post('/graphql').send({ query: excessiveLimitQuery });
  assert.equal(resExcessive.status, 400);
  assert.ok(resExcessive.body.errors && resExcessive.body.errors.length > 0);
  assert.match(resExcessive.body.errors[0].message, /cannot exceed 50/i);

  // Attempt limit: 0
  const zeroLimitQuery = `
    query {
      events(limit: 0) {
        id
      }
    }
  `;

  const resZero = await request(app).post('/graphql').send({ query: zeroLimitQuery });
  assert.equal(resZero.status, 400);
  assert.ok(resZero.body.errors && resZero.body.errors.length > 0);
  assert.match(resZero.body.errors[0].message, /must be at least 1/i);
});

test('GraphQL Cursor-based Relay Connection: tasksConnection & eventsConnection', async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  const connectionQuery = `
    query {
      tasksConnection(first: 10) {
        totalCount
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          cursor
          node {
            task_id
            creator
            target
          }
        }
      }
    }
  `;

  const res = await request(app).post('/graphql').send({ query: connectionQuery });
  assert.equal(res.status, 200);
  assert.equal(res.body.errors, undefined);
  assert.ok(res.body.data.tasksConnection);
  assert.ok(Array.isArray(res.body.data.tasksConnection.edges));
  assert.ok(res.body.data.tasksConnection.pageInfo);
});

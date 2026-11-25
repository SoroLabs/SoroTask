"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const WebSocket = require("ws");
const { SubscriptionClient } = require("subscriptions-transport-ws");

const { createExpressApp, startApiServer } = require("../src/api");
const { pubsub, EVENT_ADDED } = require("../src/graphql/pubsub");

test("GraphQL executionHistory query is wired end-to-end", async () => {
  const app = createExpressApp();
  await app.locals.graphqlReady;

  const res = await request(app)
    .post("/graphql")
    .send({ query: "{ executionHistory(limit: 1) { keeper fee } }" });

  assert.equal(res.status, 200);
  assert.equal(res.body.errors, undefined);
  assert.ok(Array.isArray(res.body.data.executionHistory));
});

test("eventAdded subscription streams a published event to a connected client, filtered by task_id", async () => {
  const httpServer = await startApiServer(0);
  const port = httpServer.address().port;

  const client = new SubscriptionClient(
    `ws://localhost:${port}/graphql`,
    { reconnect: false },
    WebSocket,
  );

  let sub;
  try {
    const received = [];
    const observable = client.request({
      query: `subscription($taskId: Int) {
        eventAdded(task_id: $taskId) { id event_name task_id }
      }`,
      variables: { taskId: 42 },
    });

    const firstEvent = new Promise((resolve, reject) => {
      sub = observable.subscribe({
        next: (result) => {
          received.push(result);
          resolve();
        },
        error: reject,
      });
    });

    // Give the server a moment to register the subscription before
    // publishing - only the matching (task_id: 42) event should arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    pubsub.publish(EVENT_ADDED, {
      eventAdded: { id: 1, event_name: "TaskRegistered", task_id: 99, contract_id: "C1" },
    });
    pubsub.publish(EVENT_ADDED, {
      eventAdded: { id: 2, event_name: "KeeperPaid", task_id: 42, contract_id: "C1" },
    });

    await Promise.race([
      firstEvent,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000)),
    ]);

    assert.equal(received.length, 1);
    assert.equal(received[0].data.eventAdded.task_id, 42);
    assert.equal(received[0].data.eventAdded.event_name, "KeeperPaid");
  } finally {
    if (sub) sub.unsubscribe();
    client.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

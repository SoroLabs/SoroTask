"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const WebSocket = require("ws");

const {
  createWsServer,
  broadcastEvent,
  eventTopics,
  topicMatches,
  _resetForTests,
} = require("../src/wsServer");

test("topicMatches: wildcard prefix and exact matching", () => {
  assert.equal(topicMatches("task:*", "task:5:TaskRegistered"), true);
  assert.equal(topicMatches("task:*", "keeper:K"), false);
  assert.equal(topicMatches("task:5", "task:5"), true);
  assert.equal(topicMatches("task:5", "task:6"), false);
  assert.equal(topicMatches("*", "anything"), true);
});

test("eventTopics: derives task/keeper/contract topics", () => {
  const topics = eventTopics({
    event_name: "KeeperPaid",
    task_id: 7,
    contract_id: "C1",
    data: { keeper: "GKEEPER" },
  });
  assert.ok(topics.includes("keeper:GKEEPER"));
  assert.ok(topics.includes("task:7"));
  assert.ok(topics.includes("contract:C1"));
});

function connect(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
  });
}

function nextEvent(ws, timeoutMs = 500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "event") {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function subscribe(ws, topic) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "subscribed" && msg.topic === topic) {
        ws.off("message", handler);
        resolve();
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ action: "subscribe", topic }));
  });
}

test("ws: subscriber receives a matching event; non-matching subscriber does not", async () => {
  _resetForTests();
  const server = createWsServer({ port: 0, path: "/ws" });
  const port = server.wss.address().port;

  const matching = await connect(port);
  const nonMatching = await connect(port);

  await subscribe(matching, "task:*");
  await subscribe(nonMatching, "keeper:*");

  const matchingRecv = nextEvent(matching);
  const nonMatchingRecv = nextEvent(nonMatching);

  // Ingest a task-scoped event.
  broadcastEvent({
    ledger_sequence: 10,
    contract_id: "C1",
    event_name: "TaskRegistered",
    task_id: 42,
    data: { creator: "A" },
  });

  const got = await matchingRecv;
  assert.ok(got, "matching subscriber received an event");
  assert.equal(got.event.task_id, 42);
  assert.equal(got.event.event_name, "TaskRegistered");
  assert.ok(got.topic.startsWith("task:"));

  const none = await nonMatchingRecv;
  assert.equal(none, null, "non-matching subscriber received nothing");

  matching.close();
  nonMatching.close();
  await server.close();
});

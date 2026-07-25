"use strict";

/**
 * Real-time WebSocket event streaming server (issue #861).
 *
 * Clients connect and subscribe to topics using prefix/wildcard patterns:
 *   task:*        -> all task-scoped events
 *   keeper:*      -> all keeper-scoped events
 *   contract:*    -> all contract-scoped events
 *   task:5        -> events for task 5 (exact)
 *   task:5:*      -> events for task 5 (prefix)
 *
 * As events are ingested by the polling pipeline (indexer/src/index.js), they
 * are handed to `broadcastEvent`, which pushes them to every connected client
 * whose subscriptions match. This is a simple in-process pub/sub keyed by topic
 * prefix -- intentionally not a distributed message bus.
 *
 * Client protocol (JSON text frames):
 *   -> { "action": "subscribe",   "topic": "task:*" }
 *   -> { "action": "unsubscribe", "topic": "task:*" }
 *   <- { "type": "subscribed",   "topic": "task:*" }
 *   <- { "type": "event", "topic": "task:5:TaskRegistered", "event": { ... } }
 */

const { WebSocketServer } = require("ws");

// Module-level singleton so the ingestion pipeline can broadcast without
// threading the server instance through every call site.
let activeServer = null;

/**
 * Derive the set of topics an event belongs to.
 * @param {{event_name:string, task_id?:number, contract_id?:string, data?:object}} event
 * @returns {string[]}
 */
function eventTopics(event) {
  const topics = [];
  const name = event.event_name;

  if (name === "KeeperPaid") {
    const keeper = event.data && event.data.keeper;
    if (keeper) topics.push(`keeper:${keeper}`);
    topics.push(`keeper:${name}`);
  }

  if (event.task_id !== undefined && event.task_id !== null && !Number.isNaN(event.task_id)) {
    topics.push(`task:${event.task_id}`);
    topics.push(`task:${event.task_id}:${name}`);
  }

  if (event.contract_id) {
    topics.push(`contract:${event.contract_id}`);
    topics.push(`contract:${event.contract_id}:${name}`);
  }

  return [...new Set(topics)];
}

/**
 * Does a subscription pattern match a concrete topic?
 * `foo:*` matches any topic beginning with `foo:`; otherwise exact match.
 * @param {string} pattern
 * @param {string} topic
 * @returns {boolean}
 */
function topicMatches(pattern, topic) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return topic.startsWith(pattern.slice(0, -1));
  }
  return pattern === topic;
}

/**
 * True if any of the client's subscription patterns matches any of the event's
 * topics.
 * @param {Set<string>} subscriptions
 * @param {string[]} topics
 * @returns {string|null} the first matching topic, or null
 */
function firstMatchingTopic(subscriptions, topics) {
  for (const topic of topics) {
    for (const pattern of subscriptions) {
      if (topicMatches(pattern, topic)) return topic;
    }
  }
  return null;
}

/**
 * Create and attach a WebSocket server.
 * @param {object} opts
 * @param {import('http').Server} [opts.server] existing HTTP server to attach to
 * @param {number} [opts.port] port to listen on if no server is provided
 * @param {string} [opts.path] WS path (default '/ws')
 * @returns {{ wss: import('ws').WebSocketServer, broadcast: Function, close: Function }}
 */
function createWsServer(opts = {}) {
  const path = opts.path || "/ws";
  const wssOptions = opts.server ? { server: opts.server, path } : { port: opts.port, path };
  const wss = new WebSocketServer(wssOptions);

  wss.on("connection", (socket) => {
    socket._subscriptions = new Set();

    socket.send(JSON.stringify({ type: "welcome", topics: ["task:*", "keeper:*", "contract:*"] }));

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_err) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (msg.action === "subscribe" && typeof msg.topic === "string") {
        socket._subscriptions.add(msg.topic);
        socket.send(JSON.stringify({ type: "subscribed", topic: msg.topic }));
      } else if (msg.action === "unsubscribe" && typeof msg.topic === "string") {
        socket._subscriptions.delete(msg.topic);
        socket.send(JSON.stringify({ type: "unsubscribed", topic: msg.topic }));
      } else {
        socket.send(JSON.stringify({ type: "error", message: "Unknown action" }));
      }
    });
  });

  const server = {
    wss,
    broadcast(event) {
      const topics = eventTopics(event);
      for (const socket of wss.clients) {
        if (socket.readyState !== socket.OPEN) continue;
        const matched = firstMatchingTopic(socket._subscriptions || new Set(), topics);
        if (matched) {
          socket.send(JSON.stringify({ type: "event", topic: matched, event }));
        }
      }
    },
    close() {
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };

  activeServer = server;
  return server;
}

/**
 * Broadcast an event through the active WebSocket server (no-op if none).
 * Called by the ingestion pipeline.
 * @param {object} event
 */
function broadcastEvent(event) {
  if (activeServer) activeServer.broadcast(event);
}

function getActiveServer() {
  return activeServer;
}

function _resetForTests() {
  activeServer = null;
}

module.exports = {
  createWsServer,
  broadcastEvent,
  getActiveServer,
  eventTopics,
  topicMatches,
  firstMatchingTopic,
  _resetForTests,
};

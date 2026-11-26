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
 *
 * Backpressure & Client Buffer Congestion Control (Issue #1068):
 *   - Routes events through subscription indexes instead of scanning all clients
 *   - Bounds each slow client's queue and drops non-critical events under load
 *   - Terminates clients that miss heartbeat pongs
 */

const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

// ─── Backpressure Configuration ──────────────────────────────────────────────
const MAX_BUFFER_SIZE = parseInt(process.env.WS_MAX_BUFFER_SIZE, 10) || 1048576; // 1MB
const CLIENT_TIMEOUT_MS = parseInt(process.env.WS_CLIENT_TIMEOUT_MS, 10) || 10000; // 10 seconds
const LOW_WATERMARK = parseInt(process.env.WS_LOW_WATERMARK, 10) || 524288; // 512KB - resume sending
const MAX_CLIENT_QUEUE_BYTES = parseInt(process.env.WS_MAX_CLIENT_QUEUE_BYTES, 10) || 1048576;

// Non-critical event types that can be dropped under backpressure
const LOW_PRIORITY_EVENTS = new Set([
  'metrics',
  'heartbeat',
  'stats',
  'debug',
]);

/**
 * Check if an event should be queued rather than dropped under backpressure.
 * @param {object} event
 * @returns {boolean}
 */
function isHighPriority(event) {
  if (!event || !event.event_name) return true;
  return !LOW_PRIORITY_EVENTS.has(event.event_name.toLowerCase());
}

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

  // Creator channels (issue #1212): any event carrying a creator address
  // (in data or at the top level) fans out to creator:{address} so clients
  // can subscribe to all executions of their own tasks.
  const creator = event.creator || (event.data && event.data.creator);
  if (creator && typeof creator === "string") {
    topics.push(`creator:${creator}`);
    topics.push(`creator:${creator}:${name}`);
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
  wssOptions.perMessageDeflate = false;
  wssOptions.maxPayload = opts.maxPayload || 1024 * 1024;
  const wss = new WebSocketServer(wssOptions);
  const exactSubscribers = new Map();
  const wildcardRoot = { subscribers: new Set(), children: new Map() };
  const drainTimers = new Map();
  const maxQueueBytes = opts.maxClientQueueBytes || MAX_CLIENT_QUEUE_BYTES;
  const heartbeatIntervalMs = opts.heartbeatIntervalMs
    || Math.max(1000, Math.floor(CLIENT_TIMEOUT_MS / 2));

  function updateSubscriptionIndex(socket, pattern, add) {
    if (pattern.endsWith('*')) {
      let node = wildcardRoot;
      const prefix = pattern.slice(0, -1);
      const pathNodes = [];
      for (const character of prefix) {
        if (!node.children.has(character)) {
          if (!add) return;
          node.children.set(character, { subscribers: new Set(), children: new Map() });
        }
        pathNodes.push([node, character]);
        node = node.children.get(character);
      }
      if (add) node.subscribers.add(socket);
      else {
        node.subscribers.delete(socket);
        for (let i = pathNodes.length - 1; i >= 0; i--) {
          const [parent, character] = pathNodes[i];
          const child = parent.children.get(character);
          if (child.subscribers.size || child.children.size) break;
          parent.children.delete(character);
        }
      }
      return;
    }

    let subscribers = exactSubscribers.get(pattern);
    if (!subscribers && add) {
      subscribers = new Set();
      exactSubscribers.set(pattern, subscribers);
    }
    if (!subscribers) return;
    if (add) subscribers.add(socket);
    else {
      subscribers.delete(socket);
      if (subscribers.size === 0) exactSubscribers.delete(pattern);
    }
  }

  function removeClient(socket) {
    for (const pattern of socket._subscriptions || []) {
      updateSubscriptionIndex(socket, pattern, false);
    }
    socket._subscriptions?.clear();
    socket._pendingMessages = [];
    socket._pendingBytes = 0;
    const timer = drainTimers.get(socket);
    if (timer) clearTimeout(timer);
    drainTimers.delete(socket);
  }

  function getMatchingClients(topics) {
    const matches = new Map();
    for (const topic of topics) {
      const exact = exactSubscribers.get(topic);
      if (exact) {
        for (const socket of exact) {
          if (!matches.has(socket)) matches.set(socket, topic);
        }
      }

      let node = wildcardRoot;
      for (const socket of node.subscribers) {
        if (!matches.has(socket)) matches.set(socket, topic);
      }
      for (const character of topic) {
        node = node.children.get(character);
        if (!node) break;
        for (const socket of node.subscribers) {
          if (!matches.has(socket)) matches.set(socket, topic);
        }
      }
    }
    return matches;
  }

  function sendMessage(socket, message, isEvent = false) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(message, (err) => {
        if (err) console.error('[WS] Send error:', err.message);
      });
      if (isEvent) socket._eventsSent++;
      return true;
    } catch (err) {
      console.error('[WS] Send error:', err.message);
      return false;
    }
  }

  function drainClientQueue(socket) {
    if (socket.readyState !== WebSocket.OPEN) {
      removeClient(socket);
      return;
    }
    while (socket._pendingMessages.length && socket.bufferedAmount < LOW_WATERMARK) {
      const queued = socket._pendingMessages.shift();
      socket._pendingBytes -= queued.bytes;
      if (!sendMessage(socket, queued.message, true)) break;
    }
    if (socket._pendingMessages.length) {
      const timer = setTimeout(() => drainClientQueue(socket), 25);
      if (typeof timer.unref === 'function') timer.unref();
      drainTimers.set(socket, timer);
    } else {
      drainTimers.delete(socket);
    }
  }

  function queueEvent(socket, message) {
    const bytes = Buffer.byteLength(message);
    if (socket._pendingBytes + bytes > maxQueueBytes) {
      socket._eventsDropped++;
      socket.terminate();
      return;
    }
    socket._pendingMessages.push({ message, bytes });
    socket._pendingBytes += bytes;
    if (!drainTimers.has(socket)) {
      const timer = setTimeout(() => drainClientQueue(socket), 25);
      if (typeof timer.unref === 'function') timer.unref();
      drainTimers.set(socket, timer);
    }
  }

  function sendEvent(socket, event, message) {
    const buffered = socket.bufferedAmount || 0;
    if (!isHighPriority(event) && buffered > LOW_WATERMARK) {
      socket._eventsDropped++;
      return;
    }
    if (buffered + Buffer.byteLength(message) <= MAX_BUFFER_SIZE
      && socket._pendingMessages.length === 0) {
      if (sendMessage(socket, message, true)) return;
    }
    if (isHighPriority(event)) {
      queueEvent(socket, message);
    } else {
      socket._eventsDropped++;
    }
  }

  wss.on("connection", (socket) => {
    socket._subscriptions = new Set();
    socket._lastActivity = Date.now();
    socket._eventsSent = 0;
    socket._eventsDropped = 0;
    socket._pendingMessages = [];
    socket._pendingBytes = 0;
    socket._isAlive = true;

    socket.send(JSON.stringify({ type: "welcome", topics: ["task:*", "keeper:*", "contract:*"] }));
    socket.on('pong', () => {
      socket._isAlive = true;
    });

    socket.on("message", (raw) => {
      socket._lastActivity = Date.now();
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_err) {
        sendMessage(socket, JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const topics = Array.isArray(msg.topics) ? msg.topics : [msg.topic];
      if (msg.action === "subscribe" && topics.every((topic) => typeof topic === 'string'
        && topic.length > 0 && topic.length <= 256)) {
        const newTopics = new Set(topics.filter((topic) => !socket._subscriptions.has(topic)));
        if (socket._subscriptions.size + newTopics.size > 100) {
          sendMessage(socket, JSON.stringify({ type: 'error', message: 'Subscription limit reached' }));
          return;
        }
        for (const topic of topics) {
          socket._subscriptions.add(topic);
          updateSubscriptionIndex(socket, topic, true);
        }
        sendMessage(socket, JSON.stringify({
          type: "subscribed",
          ...(Array.isArray(msg.topics) ? { topics: [...socket._subscriptions] } : { topic: msg.topic }),
        }));
      } else if (msg.action === "unsubscribe" && topics.every((topic) => typeof topic === 'string'
        && topic.length > 0 && topic.length <= 256)) {
        for (const topic of topics) {
          socket._subscriptions.delete(topic);
          updateSubscriptionIndex(socket, topic, false);
        }
        sendMessage(socket, JSON.stringify({
          type: "unsubscribed",
          ...(Array.isArray(msg.topics) ? { topics: [...socket._subscriptions] } : { topic: msg.topic }),
        }));
      } else {
        sendMessage(socket, JSON.stringify({ type: "error", message: "Unknown or invalid action" }));
      }
    });

    socket.on("close", () => {
      removeClient(socket);
    });

    socket.on("error", (err) => {
      removeClient(socket);
      console.error("[WS] Socket error:", err.message);
    });
  });

  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!socket._isAlive) {
        socket.terminate();
        continue;
      }
      socket._isAlive = false;
      try {
        socket.ping();
      } catch (_err) {
        socket.terminate();
      }
    }
  }, heartbeatIntervalMs);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  const server = {
    wss,
    broadcast(event) {
      const topics = eventTopics(event);
      const matches = getMatchingClients(topics);
      for (const [socket, matched] of matches) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const message = JSON.stringify({ type: "event", topic: matched, event });
        sendEvent(socket, event, message);
      }
    },
    close() {
      clearInterval(heartbeatTimer);
      for (const socket of wss.clients) {
        removeClient(socket);
        socket.terminate();
      }
      if (activeServer === server) activeServer = null;
      return new Promise((resolve) => wss.close(() => resolve()));
    },
    /**
     * Get statistics about connected clients
     * @returns {object}
     */
    getStats() {
      const clients = [];
      for (const socket of wss.clients) {
        clients.push({
          subscriptions: Array.from(socket._subscriptions || []),
          bufferedAmount: socket.bufferedAmount || 0,
          eventsSent: socket._eventsSent || 0,
          eventsDropped: socket._eventsDropped || 0,
          pendingBytes: socket._pendingBytes || 0,
          lastActivity: socket._lastActivity,
        });
      }
      return {
        connectedClients: clients.length,
        clients,
        maxBufferSize: MAX_BUFFER_SIZE,
        lowWatermark: LOW_WATERMARK,
        clientTimeoutMs: CLIENT_TIMEOUT_MS,
        maxClientQueueBytes: maxQueueBytes,
      };
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

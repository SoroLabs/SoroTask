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
 *   - Monitors socket.bufferedAmount before pushing data to clients
 *   - Drops non-critical events when buffer exceeds MAX_BUFFER_SIZE
 *   - Terminates connections for unresponsive clients after CLIENT_TIMEOUT_MS
 */

const { WebSocketServer } = require("ws");

// ─── Backpressure Configuration ──────────────────────────────────────────────
const MAX_BUFFER_SIZE = parseInt(process.env.WS_MAX_BUFFER_SIZE, 10) || 1048576; // 1MB
const CLIENT_TIMEOUT_MS = parseInt(process.env.WS_CLIENT_TIMEOUT_MS, 10) || 10000; // 10 seconds
const LOW_WATERMARK = parseInt(process.env.WS_LOW_WATERMARK, 10) || 524288; // 512KB - resume sending
const PRIORITY_HIGH = 'high';
const PRIORITY_LOW = 'low';

// Non-critical event types that can be dropped under backpressure
const LOW_PRIORITY_EVENTS = new Set([
  'metrics',
  'heartbeat',
  'stats',
  'debug',
]);

/**
 * Check if an event is high priority (should never be dropped)
 * @param {object} event
 * @returns {boolean}
 */
function isHighPriority(event) {
  if (!event || !event.event_name) return true;
  return !LOW_PRIORITY_EVENTS.has(event.event_name.toLowerCase());
}

/**
 * Determine if an event should be sent based on buffer state
 * @param {import('ws').WebSocket} socket
 * @param {object} event
 * @returns {{ shouldSend: boolean, reason?: string }}
 */
function shouldSendEvent(socket, event) {
  const buffered = socket.bufferedAmount || 0;
  
  // Always send high-priority events
  if (isHighPriority(event)) {
    if (buffered > MAX_BUFFER_SIZE) {
      // Even high-priority events can't be sent if buffer is critically full
      // Queue them instead of dropping
      return { shouldSend: false, reason: 'buffer_critical' };
    }
    return { shouldSend: true };
  }
  
  // Low-priority events: drop if buffer exceeds low watermark
  if (buffered > LOW_WATERMARK) {
    return { shouldSend: false, reason: 'backpressure_drop' };
  }
  
  return { shouldSend: true };
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

  // Track clients for timeout monitoring
  const clientTimers = new Map();

  /**
   * Start or reset the inactivity timeout for a client
   * @param {import('ws').WebSocket} socket
   */
  function startClientTimeout(socket) {
    // Clear existing timer
    if (clientTimers.has(socket)) {
      clearTimeout(clientTimers.get(socket));
    }
    
    // Set new timeout
    const timer = setTimeout(() => {
      console.warn(`[WS] Terminating unresponsive client (buffered: ${socket.bufferedAmount} bytes)`);
      try {
        socket.close(1000, 'Inactivity timeout');
      } catch (err) {
        // Socket may already be closed
      }
      clientTimers.delete(socket);
    }, CLIENT_TIMEOUT_MS);
    
    clientTimers.set(socket, timer);
  }

  /**
   * Clear the timeout for a client
   * @param {import('ws').WebSocket} socket
   */
  function clearClientTimeout(socket) {
    if (clientTimers.has(socket)) {
      clearTimeout(clientTimers.get(socket));
      clientTimers.delete(socket);
    }
  }

  wss.on("connection", (socket) => {
    socket._subscriptions = new Set();
    socket._lastActivity = Date.now();
    socket._eventsSent = 0;
    socket._eventsDropped = 0;

    // Start inactivity timeout
    startClientTimeout(socket);

    socket.send(JSON.stringify({ type: "welcome", topics: ["task:*", "keeper:*", "contract:*"] }));

    socket.on("message", (raw) => {
      // Update last activity timestamp
      socket._lastActivity = Date.now();
      startClientTimeout(socket);
      
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

    socket.on("close", () => {
      clearClientTimeout(socket);
    });

    socket.on("error", (err) => {
      clearClientTimeout(socket);
      console.error("[WS] Socket error:", err.message);
    });
  });

  const server = {
    wss,
    broadcast(event) {
      const topics = eventTopics(event);
      const queuedHighPriority = [];
      
      for (const socket of wss.clients) {
        if (socket.readyState !== socket.OPEN) continue;
        const matched = firstMatchingTopic(socket._subscriptions || new Set(), topics);
        if (!matched) continue;
        
        // Check backpressure before sending
        const { shouldSend, reason } = shouldSendEvent(socket, event);
        
        if (shouldSend) {
          try {
            socket.send(JSON.stringify({ type: "event", topic: matched, event }));
            socket._eventsSent++;
          } catch (err) {
            console.error("[WS] Send error:", err.message);
          }
        } else {
          socket._eventsDropped++;
          
          // Queue high-priority events that couldn't be sent due to critical buffer
          if (reason === 'buffer_critical' && isHighPriority(event)) {
            queuedHighPriority.push({ socket, matched, event });
          }
        }
      }
      
      // Retry queued high-priority events when buffers drain
      if (queuedHighPriority.length > 0) {
        setTimeout(() => {
          for (const { socket, matched, event: queuedEvent } of queuedHighPriority) {
            if (socket.readyState !== socket.OPEN) continue;
            if ((socket.bufferedAmount || 0) < LOW_WATERMARK) {
              try {
                socket.send(JSON.stringify({ type: "event", topic: matched, event: queuedEvent }));
                socket._eventsSent++;
              } catch (err) {
                console.error("[WS] Retry send error:", err.message);
              }
            }
          }
        }, 100);
      }
    },
    close() {
      // Clear all client timers
      for (const timer of clientTimers.values()) {
        clearTimeout(timer);
      }
      clientTimers.clear();
      
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
          lastActivity: socket._lastActivity,
        });
      }
      return {
        connectedClients: clients.length,
        clients,
        maxBufferSize: MAX_BUFFER_SIZE,
        lowWatermark: LOW_WATERMARK,
        clientTimeoutMs: CLIENT_TIMEOUT_MS,
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

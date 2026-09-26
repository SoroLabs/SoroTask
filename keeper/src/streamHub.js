const crypto = require('crypto');
const EventEmitter = require('events');
const Redis = require('ioredis');
const { Server: SocketIOServer } = require('socket.io');
const { createLogger } = require('./logger');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45000;
const DEFAULT_SSE_PATH = '/stream/sse';

function createEventId() {
  return crypto.randomBytes(12).toString('hex');
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

/**
 * Does a subscription pattern match a concrete topic?
 * `foo:*` matches any topic beginning with `foo:`; `*` matches everything;
 * otherwise exact match (issue #1212).
 * @param {string} pattern
 * @param {string} topic
 * @returns {boolean}
 */
function topicMatches(pattern, topic) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return topic.startsWith(pattern.slice(0, -1));
  }
  return pattern === topic;
}

/**
 * True if any of the client's subscription patterns matches any of the
 * event's concrete topics (issue #1212).
 * @param {Set<string>|string[]} subscriptions
 * @param {string[]} topics
 * @returns {boolean}
 */
function anyTopicMatches(subscriptions, topics) {
  if (!subscriptions || subscriptions.size === 0) return true;
  for (const topic of topics) {
    for (const pattern of subscriptions) {
      if (topicMatches(pattern, topic)) return true;
    }
  }
  return false;
}

class StreamHub extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger('stream-hub');
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || null;
    this.channel = options.channel || 'sorotask:keeper-stream';
    this.namespace = options.namespace || '/stream';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs
      || parseInt(process.env.STREAM_HUB_HEARTBEAT_MS, 10)
      || DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs
      || parseInt(process.env.STREAM_HUB_HEARTBEAT_TIMEOUT_MS, 10)
      || DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.ssePath = options.ssePath || process.env.STREAM_HUB_SSE_PATH || DEFAULT_SSE_PATH;

    this.httpServer = null;
    this.io = null;
    this.namespaceServer = null;
    this.publisher = null;
    this.subscriber = null;
    this.started = false;
    this.clientCount = 0;
    this.eventCount = 0;
    /** @type {Map<string, { socket: object, topics: Set<string>, lastPong: number }>} */
    this.clients = new Map();
    /** @type {Map<object, { res: object, topics: Set<string>, timer: object }>} */
    this.sseClients = new Map();
    this._heartbeatHandle = null;
    this._sseRequestHandler = null;
    this._sseAttached = false;
  }

  async start(httpServer) {
    if (this.started) {
      return this.getStatus();
    }

    if (!httpServer) {
      throw new Error('An HTTP server is required to start the stream hub');
    }

    this.httpServer = httpServer;
    this.io = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
      serveClient: false,
    });

    this.namespaceServer = this.io.of(this.namespace);
    this.namespaceServer.on('connection', (socket) => {
      this.clientCount += 1;

      const client = {
        socket,
        topics: new Set(),
        lastPong: Date.now(),
      };
      this.clients.set(socket.id, client);

      socket.data.streamTopics = client.topics;
      socket.emit('stream:ready', this.getStatus());

      // Channel subscriptions (issue #1212): task:{id}, creator:{address},
      // wildcard patterns (task:*, creator:*, *), or no subscription at all
      // to receive every event. Clients re-send these after a reconnect so
      // the connection auto-recovers its channels.
      socket.on('stream:subscribe', (topics, ack) => {
        const requested = Array.isArray(topics) ? topics : [topics];
        for (const topic of requested) {
          if (typeof topic === 'string' && topic.length > 0) {
            client.topics.add(topic);
          }
        }
        if (typeof ack === 'function') {
          ack({ subscribed: [...client.topics] });
        }
      });

      socket.on('stream:unsubscribe', (topic, ack) => {
        if (typeof topic === 'string') {
          client.topics.delete(topic);
        }
        if (typeof ack === 'function') {
          ack({ subscribed: [...client.topics] });
        }
      });

      socket.on('stream:pong', () => {
        client.lastPong = Date.now();
      });

      socket.on('disconnect', () => {
        this.clientCount = Math.max(0, this.clientCount - 1);
        this.clients.delete(socket.id);
      });
    });

    if (this.redisUrl) {
      this.publisher = new Redis(this.redisUrl);
      this.subscriber = new Redis(this.redisUrl);

      const markRedisError = (error) => {
        this.logger.warn('Stream hub Redis error', { error: error.message });
      };

      this.publisher.on('error', markRedisError);
      this.subscriber.on('error', markRedisError);

      this.subscriber.on('message', (_channel, message) => {
        const envelope = safeParseJson(message);
        if (envelope) {
          this.emitEnvelope(envelope, { localOnly: true });
        }
      });

      await this.subscriber.subscribe(this.channel);
    }

    // Heartbeat ping/pong: keeps intermediaries from reaping idle stream
    // connections and lets the hub terminate dead sockets (issue #1212).
    if (this.heartbeatIntervalMs > 0) {
      this._heartbeatHandle = setInterval(() => {
        this._runHeartbeat();
      }, this.heartbeatIntervalMs);
      if (typeof this._heartbeatHandle.unref === 'function') {
        this._heartbeatHandle.unref();
      }
    }

    this.started = true;
    this.logger.info('Realtime stream hub started', {
      namespace: this.namespace,
      redisEnabled: Boolean(this.redisUrl),
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    });

    return this.getStatus();
  }

  /**
   * Heartbeat tick: emit a ping to every connected client and terminate
   * sockets that have not ponged within the timeout window (issue #1212).
   * @private
   */
  _runHeartbeat() {
    const now = Date.now();

    if (this.namespaceServer) {
      this.namespaceServer.emit('stream:ping', { timestamp: now });
    }

    for (const [socketId, client] of this.clients) {
      if (now - client.lastPong > this.heartbeatTimeoutMs) {
        this.logger.warn('Terminating unresponsive stream client', { socketId });
        try {
          client.socket.disconnect(true);
        } catch (_) {
          // Socket may already be gone
        }
        this.clients.delete(socketId);
        this.clientCount = Math.max(0, this.clientCount - 1);
      }
    }
  }

  /**
   * Attach an SSE endpoint to the same HTTP server the WebSocket namespace
   * runs on (issue #1212). Clients receive the same envelopes as WebSocket
   * subscribers; the optional `?topics=` query param (comma-separated
   * patterns, e.g. `task:*,creator:GABC`) filters events. EventSource
   * auto-reconnects on drops, so connections auto-recover.
   *
   * @param {string} [path]
   * @returns {string} the attached path
   */
  attachSse(path = this.ssePath) {
    if (!this.httpServer) {
      throw new Error('Call start(httpServer) before attachSse()');
    }
    if (this._sseAttached) {
      return this._ssePath;
    }

    this._ssePath = path;
    this._sseRequestHandler = (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== this._ssePath) {
        return;
      }
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      const topicParam = url.searchParams.get('topics');
      const topics = new Set(
        (topicParam ? topicParam.split(',') : [])
          .map((t) => t.trim())
          .filter(Boolean),
      );

      const client = {
        res,
        topics,
        timer: setInterval(() => {
          try {
            res.write(`: ping ${Date.now()}\n\n`);
          } catch (_) {
            // Response already closed
          }
        }, this.heartbeatIntervalMs),
      };
      if (typeof client.timer.unref === 'function') {
        client.timer.unref();
      }
      this.sseClients.set(res, client);

      res.write(`data: ${JSON.stringify({ type: 'stream:ready', payload: this.getStatus() })}\n\n`);

      res.on('close', () => {
        clearInterval(client.timer);
        this.sseClients.delete(res);
      });
    };

    this.httpServer.on('request', this._sseRequestHandler);
    this._sseAttached = true;
    this.logger.info('SSE stream endpoint attached', { path: this._ssePath });
    return this._ssePath;
  }

  /**
   * Concrete topics an envelope belongs to: its own type, the task channel
   * (`task:{taskId}`) when the payload carries a task id, and the creator
   * channel (`creator:{address}`) when the payload identifies the task
   * creator (issue #1212).
   * @param {object} normalized
   * @returns {string[]}
   * @private
   */
  _envelopeTopics(normalized) {
    const topics = [normalized.type];
    const payload = normalized.payload || {};
    const taskId = payload.taskId ?? payload.task_id;
    if (taskId !== undefined && taskId !== null) {
      topics.push(`task:${String(taskId)}`);
    }
    const creator = payload.creatorAddress ?? payload.creator;
    if (creator) {
      topics.push(`creator:${String(creator)}`);
    }
    return [...new Set(topics)];
  }

  /**
   * Deliver an envelope: sockets without any subscription receive every
   * event; sockets with subscriptions only receive events whose topics
   * match one of their patterns (issue #1212).
   * @param {object} normalized
   * @private
   */
  _deliver(normalized) {
    const sockets = this.namespaceServer && this.namespaceServer.sockets;
    const topics = this._envelopeTopics(normalized);

    if (sockets && typeof sockets.forEach === 'function') {
      sockets.forEach((socket) => {
        const client = this.clients.get(socket.id);
        const subscriptions = client ? client.topics : null;
        if (subscriptions && subscriptions.size === 0) {
          return; // explicitly opted out of every channel
        }
        if (!subscriptions || anyTopicMatches(subscriptions, topics)) {
          socket.emit('stream:event', normalized);
          socket.emit(normalized.type, normalized.payload);
        }
      });
    } else if (this.namespaceServer) {
      // Stub/test namespace without a real socket pool: keep the legacy
      // broadcast behaviour.
      this.namespaceServer.emit('stream:event', normalized);
      this.namespaceServer.emit(normalized.type, normalized.payload);
    }

    for (const [, client] of this.sseClients) {
      if (anyTopicMatches(client.topics, topics)) {
        try {
          client.res.write(`data: ${JSON.stringify(normalized)}\n\n`);
        } catch (_) {
          // Response already closed
        }
      }
    }
  }

  emitEnvelope(envelope, options = {}) {
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }

    const normalized = {
      id: envelope.id || createEventId(),
      type: envelope.type || 'event',
      payload: envelope.payload || {},
      source: envelope.source || 'keeper',
      timestamp: envelope.timestamp || new Date().toISOString(),
    };

    this.eventCount += 1;
    this._deliver(normalized);

    this.emit('event', normalized);

    if (!options.localOnly && this.publisher) {
      this.publisher.publish(this.channel, JSON.stringify(normalized)).catch((error) => {
        this.logger.warn('Failed to publish realtime event', { error: error.message });
      });
    }

    return normalized;
  }

  publish(type, payload = {}, options = {}) {
    return this.emitEnvelope({
      id: options.id || createEventId(),
      type,
      payload,
      source: options.source || 'keeper',
      timestamp: options.timestamp || new Date().toISOString(),
    });
  }

  publishTaskEvent(kind, taskId, context = {}) {
    return this.publish('task:update', {
      kind,
      taskId: String(taskId),
      context,
      creatorAddress: context.creatorAddress || null,
    });
  }

  getStatus() {
    return {
      enabled: true,
      started: this.started,
      namespace: this.namespace,
      redisEnabled: Boolean(this.redisUrl),
      clientCount: this.clientCount,
      eventCount: this.eventCount,
      subscriptionCount: [...this.clients.values()]
        .reduce((total, client) => total + client.topics.size, 0),
      sseClientCount: this.sseClients.size,
      heartbeat: {
        intervalMs: this.heartbeatIntervalMs,
        timeoutMs: this.heartbeatTimeoutMs,
      },
      ssePath: this._sseAttached ? this._ssePath : this.ssePath,
    };
  }

  async stop() {
    if (this._heartbeatHandle) {
      clearInterval(this._heartbeatHandle);
      this._heartbeatHandle = null;
    }

    for (const [, client] of this.sseClients) {
      clearInterval(client.timer);
      try {
        client.res.end();
      } catch (_) {
        // Already closed
      }
    }
    this.sseClients.clear();

    if (this._sseRequestHandler && this.httpServer) {
      this.httpServer.removeListener('request', this._sseRequestHandler);
      this._sseRequestHandler = null;
      this._sseAttached = false;
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.channel).catch(() => {});
      this.subscriber.disconnect();
      this.subscriber = null;
    }

    if (this.publisher) {
      this.publisher.disconnect();
      this.publisher = null;
    }

    if (this.io) {
      this.io.close();
      this.io = null;
      this.namespaceServer = null;
    }

    this.clients.clear();
    this.started = false;
  }
}


module.exports = { StreamHub, topicMatches };

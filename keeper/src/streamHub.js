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

function createTopicIndex() {
  return { exact: new Map(), wildcard: { subscribers: new Set(), children: new Map() } };
}

function updateTopicIndex(index, client, pattern, add) {
  if (pattern.endsWith('*')) {
    let node = index.wildcard;
    const path = [];
    for (const character of pattern.slice(0, -1)) {
      if (!node.children.has(character)) {
        if (!add) return;
        node.children.set(character, { subscribers: new Set(), children: new Map() });
      }
      path.push([node, character]);
      node = node.children.get(character);
    }
    if (add) {
      node.subscribers.add(client);
    } else {
      node.subscribers.delete(client);
      for (let i = path.length - 1; i >= 0; i--) {
        const [parent, character] = path[i];
        const child = parent.children.get(character);
        if (child.subscribers.size || child.children.size) break;
        parent.children.delete(character);
      }
    }
    return;
  }

  let subscribers = index.exact.get(pattern);
  if (!subscribers && add) {
    subscribers = new Set();
    index.exact.set(pattern, subscribers);
  }
  if (!subscribers) return;
  if (add) subscribers.add(client);
  else {
    subscribers.delete(client);
    if (subscribers.size === 0) index.exact.delete(pattern);
  }
}

function matchingTopicClients(index, topics) {
  const matches = new Map();
  for (const topic of topics) {
    const exact = index.exact.get(topic);
    if (exact) {
      for (const client of exact) {
        if (!matches.has(client)) matches.set(client, topic);
      }
    }
    let node = index.wildcard;
    for (const client of node.subscribers) {
      if (!matches.has(client)) matches.set(client, topic);
    }
    for (const character of topic) {
      node = node.children.get(character);
      if (!node) break;
      for (const client of node.subscribers) {
        if (!matches.has(client)) matches.set(client, topic);
      }
    }
  }
  return matches;
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
    this.maxBackpressureEvents = options.maxBackpressureEvents || 100;
    this.maxSseQueueBytes = options.maxSseQueueBytes || 1024 * 1024;

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
    this.topicIndex = createTopicIndex();
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
        kind: 'socket',
        socket,
        topics: new Set(),
        lastPong: Date.now(),
      };
      this.clients.set(socket.id, client);

      socket.data.streamTopics = client.topics;
      socket.emit('stream:ready', this.getStatus());

      // Clients re-send their channel subscriptions after reconnecting.
      socket.on('stream:subscribe', (topics, ack) => {
        const requested = Array.isArray(topics) ? topics : [topics];
        const rejected = [];
        for (const topic of requested) {
          if (typeof topic !== 'string' || topic.length === 0 || topic.length > 256
            || (!client.topics.has(topic) && client.topics.size >= 100)) {
            rejected.push(topic);
          } else {
            this._addSubscription(client, topic);
          }
        }
        if (typeof ack === 'function') {
          ack({ subscribed: [...client.topics], rejected });
        }
      });

      socket.on('stream:unsubscribe', (topic, ack) => {
        if (typeof topic === 'string') {
          this._removeSubscription(client, topic);
        }
        if (typeof ack === 'function') {
          ack({ subscribed: [...client.topics] });
        }
      });

      socket.on('stream:pong', () => {
        client.lastPong = Date.now();
      });

      socket.on('disconnect', () => {
        this._removeClient(socket.id);
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

    if (this.namespaceServer && typeof this.namespaceServer.emit === 'function') {
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
        this._removeClient(socketId);
      }
    }
  }

  /**
   * Attach an SSE endpoint to the same HTTP server the WebSocket namespace
   * runs on (issue #1212). Clients receive the same envelopes as WebSocket
   * subscribers; the `?topics=` query param (comma-separated patterns, e.g.
   * `task:*,creator:GABC`) selects events. EventSource
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

      const topicParam = url.searchParams.get('topics');
      const topics = new Set(
        (topicParam ? topicParam.split(',') : [])
          .map((t) => t.trim())
          .filter(Boolean),
      );
      if (topics.size > 100 || [...topics].some((topic) => topic.length > 256)) {
        res.statusCode = 400;
        res.end('Invalid or excessive topic subscriptions');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      const client = {
        kind: 'sse',
        res,
        topics,
        queue: [],
        queueBytes: 0,
        blocked: false,
        timer: setInterval(() => {
          if (!client.blocked && client.queue.length === 0) {
            this._writeSse(client, `: ping ${Date.now()}\n\n`);
          }
        }, this.heartbeatIntervalMs),
      };
      for (const topic of topics) this._addSubscription(client, topic);
      if (typeof client.timer.unref === 'function') {
        client.timer.unref();
      }
      this.sseClients.set(res, client);

      this._writeSse(client, `data: ${JSON.stringify({ type: 'stream:ready', payload: this.getStatus() })}\n\n`);

      const cleanup = () => {
        this._removeSseClient(res);
      };
      res.on('drain', () => this._drainSse(client));
      res.on('close', cleanup);
      res.on('error', cleanup);
    };

    this.httpServer.on('request', this._sseRequestHandler);
    this._sseAttached = true;
    this.logger.info('SSE stream endpoint attached', { path: this._ssePath });
    return this._ssePath;
  }

  /**
   * Concrete topics an envelope belongs to: its own type and any task,
   * creator, or keeper channels identified by its payload.
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
    const keeper = payload.keeperAddress ?? payload.keeper;
    if (keeper) {
      topics.push(`keeper:${String(keeper)}`);
    }
    return [...new Set(topics)];
  }

  _removeClient(socketId) {
    const client = this.clients.get(socketId);
    if (client && this.clients.delete(socketId)) {
      for (const topic of client.topics) updateTopicIndex(this.topicIndex, client, topic, false);
      this.clientCount = Math.max(0, this.clientCount - 1);
    }
  }

  _addSubscription(client, topic) {
    if (client.topics.has(topic) || client.topics.size >= 100) return false;
    client.topics.add(topic);
    updateTopicIndex(this.topicIndex, client, topic, true);
    return true;
  }

  _removeSubscription(client, topic) {
    if (client.topics.delete(topic)) {
      updateTopicIndex(this.topicIndex, client, topic, false);
    }
  }

  _removeSseClient(res) {
    const client = this.sseClients.get(res);
    if (!client) return;
    clearInterval(client.timer);
    client.queue.length = 0;
    client.queueBytes = 0;
    for (const topic of client.topics) updateTopicIndex(this.topicIndex, client, topic, false);
    this.sseClients.delete(res);
  }

  _writeSse(client, chunk) {
    if (client.blocked || client.queue.length > 0) {
      const bytes = Buffer.byteLength(chunk);
      if (client.queueBytes + bytes > this.maxSseQueueBytes) {
        this.logger.warn('Closing slow SSE client after buffer limit', {
          maxSseQueueBytes: this.maxSseQueueBytes,
        });
        this._removeSseClient(client.res);
        client.res.end();
        return;
      }
      client.queue.push({ chunk, bytes });
      client.queueBytes += bytes;
      return;
    }
    try {
      client.blocked = !client.res.write(chunk);
    } catch (err) {
      this.logger.warn('Failed to write SSE event', { error: err.message });
      this._removeSseClient(client.res);
      client.res.end();
    }
  }

  _drainSse(client) {
    client.blocked = false;
    while (client.queue.length > 0) {
      const queued = client.queue.shift();
      client.queueBytes -= queued.bytes;
      try {
        if (!client.res.write(queued.chunk)) {
          client.blocked = true;
          break;
        }
      } catch (err) {
        this.logger.warn('Failed to drain SSE event queue', { error: err.message });
        this._removeSseClient(client.res);
        client.res.end();
        return;
      }
    }
  }

  /**
   * Deliver an envelope only to clients with matching topic subscriptions.
   * @param {object} normalized
   * @private
   */
  _deliver(normalized) {
    const sockets = this.namespaceServer && this.namespaceServer.sockets;
    const topics = this._envelopeTopics(normalized);
    const matches = matchingTopicClients(this.topicIndex, topics);

    if (sockets && typeof sockets.forEach === 'function') {
      for (const [client] of matches) {
        if (client.kind !== 'socket') continue;
        const socket = client.socket;
        const transportWritable = !socket.conn
          || !socket.conn.transport
          || socket.conn.transport.writable !== false;
        if (!transportWritable) {
          client.backpressureDrops = (client.backpressureDrops || 0) + 1;
          if (client.backpressureDrops >= this.maxBackpressureEvents) {
            this.logger.warn('Disconnecting slow stream client', { socketId: socket.id });
            socket.disconnect(true);
            this._removeClient(socket.id);
          }
          continue;
        }
        client.backpressureDrops = 0;
        const emitter = socket.volatile || socket;
        emitter.emit('stream:event', normalized);
        emitter.emit(normalized.type, normalized.payload);
      }
    } else if (this.namespaceServer) {
      // Stub/test namespace without a real socket pool: keep the legacy
      // broadcast behaviour.
      this.namespaceServer.emit('stream:event', normalized);
      this.namespaceServer.emit(normalized.type, normalized.payload);
    }

    const frame = `data: ${JSON.stringify(normalized)}\n\n`;
    for (const [client] of matches) {
      if (client.kind === 'sse') this._writeSse(client, frame);
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
      this._removeSseClient(client.res);
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

    for (const socketId of this.clients.keys()) {
      this._removeClient(socketId);
    }

    if (this.io) {
      this.io.close();
      this.io = null;
      this.namespaceServer = null;
    }

    this.clients.clear();
    this.clientCount = 0;
    this.started = false;
  }
}


module.exports = { StreamHub, topicMatches };

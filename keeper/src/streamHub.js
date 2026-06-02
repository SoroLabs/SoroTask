const crypto = require('crypto');
const EventEmitter = require('events');
const Redis = require('ioredis');
const { Server: SocketIOServer } = require('socket.io');
const { createLogger } = require('./logger');

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

class StreamHub extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger('stream-hub');
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || null;
    this.channel = options.channel || 'sorotask:keeper-stream';
    this.namespace = options.namespace || '/stream';

    this.httpServer = null;
    this.io = null;
    this.namespaceServer = null;
    this.publisher = null;
    this.subscriber = null;
    this.started = false;
    this.clientCount = 0;
    this.eventCount = 0;
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
      socket.emit('stream:ready', this.getStatus());

      socket.on('disconnect', () => {
        this.clientCount = Math.max(0, this.clientCount - 1);
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

    this.started = true;
    this.logger.info('Realtime stream hub started', {
      namespace: this.namespace,
      redisEnabled: Boolean(this.redisUrl),
    });

    return this.getStatus();
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
    if (this.namespaceServer) {
      this.namespaceServer.emit('stream:event', normalized);
      this.namespaceServer.emit(normalized.type, normalized.payload);
    }

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
    };
  }

  async stop() {
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

    this.started = false;
  }
}

module.exports = { StreamHub };
const { InMemoryReplayStore, validateTaskExecutionPayload } = require('./webhookAuth');
const { createLogger } = require('./logger');

function readRawBody(req, options = {}) {
  const maxBodyBytes = options.maxBodyBytes || 1024 * 1024;

  return new Promise((resolve, reject) => {
    let raw = '';
    let received = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      received += Buffer.byteLength(chunk);
      if (received > maxBodyBytes) {
        reject(Object.assign(new Error('Request body too large'), {
          status: 413,
          reason: 'body_too_large',
        }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

class WebhookTriggerHandler {
  constructor(options = {}) {
    this.authProtocol = options.authProtocol;
    this.enqueueTask = options.enqueueTask;
    this.path = options.path || '/webhooks/task-executions';
    this.logger = options.logger || createLogger('webhook-trigger');
    this.eventReplayStore = options.eventReplayStore || new InMemoryReplayStore();
    this.eventReplayTtlMs = options.eventReplayTtlMs || this.authProtocol?.replayTtlMs || 600000;
    this.metrics = options.metrics || null;
  }

  async handle(req, res) {
    if (req.method !== 'POST') {
      this.reject(res, 405, 'method_not_allowed');
      return;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req, {
        maxBodyBytes: this.authProtocol.maxBodyBytes,
      });
    } catch (error) {
      this.reject(res, error.status || 400, error.reason || 'body_read_failed');
      return;
    }

    const verification = this.authProtocol.verify({
      method: req.method,
      path: this.path,
      headers: req.headers,
      rawBody,
    });
    if (!verification.ok) {
      this.reject(res, verification.status || 401, verification.reason, {
        keyId: verification.keyId,
      });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (_) {
      this.reject(res, 400, 'invalid_json_payload', { keyId: verification.keyId });
      return;
    }

    const validation = validateTaskExecutionPayload(payload);
    if (!validation.ok) {
      this.reject(res, 400, validation.reason, { keyId: verification.keyId });
      return;
    }

    const event = validation.value;
    const eventReplayKey = `${verification.keyId}:${event.eventId}`;
    if (!this.eventReplayStore.consume(eventReplayKey, this.eventReplayTtlMs)) {
      this.reject(res, 409, 'event_replay_detected', {
        keyId: verification.keyId,
        eventId: event.eventId,
      });
      return;
    }

    try {
      await this.enqueueTask(event.taskId, {
        trigger: 'webhook',
        webhookEventId: event.eventId,
        webhookKeyId: verification.keyId,
        webhookNonce: verification.nonce,
        webhookSource: event.source,
        webhookReason: event.reason,
        webhookMetadata: event.metadata,
        correlationId: `webhook:${event.eventId}`,
      });
    } catch (error) {
      this.recordMetric('webhookRejectedTotal', { reason: 'enqueue_failed' });
      this.logger.error('Webhook task enqueue failed', {
        eventId: event.eventId,
        taskId: event.taskId,
        error: error.message,
      });
      writeJson(res, 503, {
        error: 'enqueue_failed',
        eventId: event.eventId,
      });
      return;
    }

    this.recordMetric('webhookAcceptedTotal', 1);
    this.logger.info('Accepted webhook task execution request', {
      eventId: event.eventId,
      taskId: event.taskId,
      source: event.source,
      keyId: verification.keyId,
    });
    writeJson(res, 202, {
      status: 'accepted',
      eventId: event.eventId,
      taskId: event.taskId,
    });
  }

  reject(res, status, reason, context = {}) {
    this.recordMetric('webhookRejectedTotal', { reason });
    if (reason && reason.includes('replay')) {
      this.recordMetric('webhookReplayRejectedTotal', 1);
    }
    this.logger.warn('Rejected webhook task execution request', {
      reason,
      status,
      ...context,
    });
    writeJson(res, status, { error: reason });
  }

  recordMetric(key, amount) {
    if (this.metrics && typeof this.metrics.increment === 'function') {
      this.metrics.increment(key, amount);
    }
  }
}

module.exports = {
  WebhookTriggerHandler,
  readRawBody,
};

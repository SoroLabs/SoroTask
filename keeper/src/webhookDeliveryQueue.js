const crypto = require('crypto');

class MemoryWebhookStore {
  constructor() { this.items = new Map(); }
  async get(key) { return this.items.get(key) || null; }
  async put(key, value) { this.items.set(key, value); return value; }
  async listDue(now) { return [...this.items.values()].filter((item) => item.status === 'pending' && item.nextAttemptAt <= now); }
}

class RedisWebhookStore {
  constructor(redis, prefix = 'sorotask:webhook:') { this.redis = redis; this.prefix = prefix; }
  async get(key) { const value = await this.redis.get(this.prefix + key); return value ? JSON.parse(value) : null; }
  async put(key, value) { await this.redis.set(this.prefix + key, JSON.stringify(value)); return value; }
  async listDue(now) {
    const keys = await this.redis.keys(this.prefix + '*');
    const values = await Promise.all(keys.map((key) => this.redis.get(key)));
    return values.filter(Boolean).map(JSON.parse).filter((item) => item.status === 'pending' && item.nextAttemptAt <= now);
  }
}

class WebhookDeliveryQueue {
  constructor(options = {}) {
    this.store = options.store || new MemoryWebhookStore();
    this.fetch = options.fetch || global.fetch;
    this.now = options.now || (() => Date.now());
    this.logger = options.logger || console;
    this.maxAgeMs = options.maxAgeMs || 72 * 60 * 60 * 1000;
    this.baseDelayMs = options.baseDelayMs || 1000;
    this.timer = null;
  }

  async enqueue({ idempotencyKey, url, payload, secret, headers = {} }) {
    if (!idempotencyKey || !url) throw new Error('Webhook idempotencyKey and url are required');
    const existing = await this.store.get(idempotencyKey);
    if (existing) return existing;
    const item = { idempotencyKey, url, payload, secret, headers, attempts: 0, status: 'pending', createdAt: this.now(), nextAttemptAt: this.now() };
    await this.store.put(idempotencyKey, item);
    return item;
  }

  _signature(item, body) {
    return `sha256=${crypto.createHmac('sha256', item.secret || '').update(body).digest('hex')}`;
  }

  async deliver(item) {
    const body = typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);
    try {
      const response = await this.fetch(item.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-id': item.idempotencyKey, 'x-sorotask-signature': this._signature(item, body), ...item.headers }, body });
      if (!response.ok) throw new Error(`webhook returned ${response.status}`);
      item.status = 'delivered'; item.deliveredAt = this.now(); item.receipt = { status: response.status };
    } catch (error) {
      item.attempts += 1;
      if (this.now() - item.createdAt >= this.maxAgeMs) item.status = 'failed';
      else item.nextAttemptAt = this.now() + Math.min(this.maxAgeMs, this.baseDelayMs * (2 ** Math.min(item.attempts, 16)));
      item.lastError = error.message;
    }
    await this.store.put(item.idempotencyKey, item);
    return item;
  }

  async processDue() { const due = await this.store.listDue(this.now()); return Promise.all(due.map((item) => this.deliver(item))); }
  start(intervalMs = 1000) { this.timer = setInterval(() => this.processDue().catch((error) => this.logger.error && this.logger.error(error)), intervalMs); if (this.timer.unref) this.timer.unref(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { WebhookDeliveryQueue, MemoryWebhookStore, RedisWebhookStore };

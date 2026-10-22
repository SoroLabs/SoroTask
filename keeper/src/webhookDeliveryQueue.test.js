const { WebhookDeliveryQueue, MemoryWebhookStore } = require('./webhookDeliveryQueue');

describe('WebhookDeliveryQueue', () => {
  test('deduplicates deliveries and signs the exact request body', async () => {
    const requests = [];
    const queue = new WebhookDeliveryQueue({ store: new MemoryWebhookStore(), fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, status: 202 }; } });
    await queue.enqueue({ idempotencyKey: 'event-1', url: 'https://consumer.test/events', payload: { type: 'settled' }, secret: 'secret' });
    await queue.enqueue({ idempotencyKey: 'event-1', url: 'https://consumer.test/events', payload: { type: 'different' }, secret: 'secret' });
    const [receipt] = await queue.processDue();
    expect(receipt.status).toBe('delivered');
    expect(requests).toHaveLength(1);
    expect(requests[0].init.headers['x-sorotask-signature']).toMatch(/^sha256=/);
  });

  test('backs off failed deliveries and keeps them pending for retry', async () => {
    let now = 1000;
    const queue = new WebhookDeliveryQueue({ store: new MemoryWebhookStore(), now: () => now, baseDelayMs: 10, fetch: async () => ({ ok: false, status: 503 }) });
    await queue.enqueue({ idempotencyKey: 'event-2', url: 'https://consumer.test/events', payload: {}, secret: 'secret' });
    const [receipt] = await queue.processDue();
    expect(receipt.status).toBe('pending');
    expect(receipt.nextAttemptAt).toBeGreaterThan(now);
  });
});

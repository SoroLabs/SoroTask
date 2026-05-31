const crypto = require('crypto');
const {
  DEFAULT_KEY_ID_HEADER,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_NONCE_HEADER,
  DEFAULT_REPLAY_TTL_MS,
  DEFAULT_SIGNATURE_HEADER,
  DEFAULT_TIMESTAMP_HEADER,
  DEFAULT_TOLERANCE_MS,
  InMemoryReplayStore,
  WebhookAuthProtocol,
  buildCanonicalRequest,
  parseSecretMap,
  signWebhookRequest,
  validateTaskExecutionPayload,
} = require('../src/webhookAuth');

describe('WebhookAuth - Utilities', () => {
  describe('parseSecretMap', () => {
    it('parses object with default key', () => {
      const result = parseSecretMap({ primary: 'secret123' });
      expect(result.get('primary')).toBe('secret123');
    });

    it('parses comma-separated string with default key', () => {
      const result = parseSecretMap('secret123');
      expect(result.get('primary')).toBe('secret123');
    });

    it('parses comma-separated key:secret pairs', () => {
      const result = parseSecretMap('key1:secret1,key2:secret2');
      expect(result.get('key1')).toBe('secret1');
      expect(result.get('key2')).toBe('secret2');
    });

    it('handles Map input', () => {
      const map = new Map([['key1', 'secret1']]);
      const result = parseSecretMap(map);
      expect(result.get('key1')).toBe('secret1');
    });

    it('returns empty map for null/undefined', () => {
      expect(parseSecretMap(null).size).toBe(0);
      expect(parseSecretMap(undefined).size).toBe(0);
      expect(parseSecretMap('').size).toBe(0);
    });

    it('filters out empty secrets', () => {
      const result = parseSecretMap({ key1: 'secret1', key2: '' });
      expect(result.get('key1')).toBe('secret1');
      expect(result.get('key2')).toBeUndefined();
    });

    it('handles mixed spacing in key:secret pairs', () => {
      const result = parseSecretMap('  key1  :  secret1  ,  key2  :  secret2  ');
      expect(result.get('key1')).toBe('secret1');
      expect(result.get('key2')).toBe('secret2');
    });

    it('uses custom default key id', () => {
      const result = parseSecretMap('secret123', 'backup');
      expect(result.get('backup')).toBe('secret123');
    });
  });

  describe('buildCanonicalRequest', () => {
    it('creates correct canonical format', () => {
      const result = buildCanonicalRequest({
        method: 'POST',
        path: '/webhooks/task-executions',
        timestamp: 1000,
        nonce: 'abc123',
        body: 'test-body',
      });

      expect(result).toBe('1000.abc123.POST./webhooks/task-executions.' + 
        crypto.createHash('sha256').update('test-body').digest('hex'));
    });

    it('handles empty body', () => {
      const result = buildCanonicalRequest({
        method: 'POST',
        path: '/',
        timestamp: 1000,
        nonce: 'abc123',
        body: '',
      });

      const emptyHash = crypto.createHash('sha256').update('').digest('hex');
      expect(result).toBe(`1000.abc123.POST./.${emptyHash}`);
    });

    it('uses default method if not provided', () => {
      const result = buildCanonicalRequest({
        path: '/',
        timestamp: 1000,
        nonce: 'abc123',
        body: '',
      });

      expect(result).toContain('.POST.');
    });

    it('uses default path if not provided', () => {
      const result = buildCanonicalRequest({
        method: 'POST',
        timestamp: 1000,
        nonce: 'abc123',
        body: '',
      });

      expect(result).toContain('./.');
    });
  });

  describe('signWebhookRequest', () => {
    it('creates valid HMAC-SHA256 signature', () => {
      const signature = signWebhookRequest({
        method: 'POST',
        path: '/webhooks/task-executions',
        timestamp: 1000,
        nonce: 'abc123',
        body: 'test-body',
        secret: 'test-secret',
      });

      const canonical = buildCanonicalRequest({
        method: 'POST',
        path: '/webhooks/task-executions',
        timestamp: 1000,
        nonce: 'abc123',
        body: 'test-body',
      });
      const expected = crypto.createHmac('sha256', 'test-secret')
        .update(canonical).digest('hex');

      expect(signature).toBe(expected);
    });

    it('produces different signatures for different bodies', () => {
      const sig1 = signWebhookRequest({
        method: 'POST',
        path: '/',
        timestamp: 1000,
        nonce: 'abc123',
        body: 'body1',
        secret: 'secret',
      });

      const sig2 = signWebhookRequest({
        method: 'POST',
        path: '/',
        timestamp: 1000,
        nonce: 'abc123',
        body: 'body2',
        secret: 'secret',
      });

      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different nonces', () => {
      const sig1 = signWebhookRequest({
        method: 'POST',
        path: '/',
        timestamp: 1000,
        nonce: 'nonce1',
        body: 'body',
        secret: 'secret',
      });

      const sig2 = signWebhookRequest({
        method: 'POST',
        path: '/',
        timestamp: 1000,
        nonce: 'nonce2',
        body: 'body',
        secret: 'secret',
      });

      expect(sig1).not.toBe(sig2);
    });
  });
});

describe('InMemoryReplayStore', () => {
  it('allows first request', () => {
    const store = new InMemoryReplayStore();
    const result = store.consume('key1', 10000);
    expect(result).toBe(true);
  });

  it('rejects duplicate requests', () => {
    const store = new InMemoryReplayStore();
    store.consume('key1', 10000);
    const result = store.consume('key1', 10000);
    expect(result).toBe(false);
  });

  it('allows different keys', () => {
    const store = new InMemoryReplayStore();
    expect(store.consume('key1', 10000)).toBe(true);
    expect(store.consume('key2', 10000)).toBe(true);
  });

  it('removes expired entries', () => {
    const now = 1000;
    const store = new InMemoryReplayStore();
    store.consume('key1', 1000, now);
    
    // Before expiration, should be rejected
    expect(store.consume('key1', 1000, now + 500)).toBe(false);
    
    // After expiration, should be allowed
    expect(store.consume('key1', 1000, now + 1500)).toBe(true);
  });

  it('returns correct size', () => {
    const store = new InMemoryReplayStore();
    expect(store.size()).toBe(0);
    store.consume('key1', 10000);
    expect(store.size()).toBe(1);
    store.consume('key2', 10000);
    expect(store.size()).toBe(2);
  });

  it('prunes expired entries before checking size', () => {
    const now = 1000;
    const store = new InMemoryReplayStore();
    store.consume('key1', 1000, now);
    store.consume('key2', 1000, now);
    
    // Check size at the original time
    const sizeBefore = store.size(now);
    
    // Check size after expiration
    const sizeAfter = store.size(now + 2000); // After expiration
    
    expect(sizeBefore).toBe(2);
    expect(sizeAfter).toBe(0);
  });

  it('respects maxEntries limit', () => {
    const store = new InMemoryReplayStore({ maxEntries: 2 });
    store.consume('key1', 10000);
    store.consume('key2', 10000);
    expect(store.size()).toBe(2);
    
    // Adding third entry should remove oldest
    store.consume('key3', 10000);
    expect(store.size()).toBe(2);
    expect(store.entries.has('key1')).toBe(false);
  });
});

describe('WebhookAuthProtocol', () => {
  describe('initialization', () => {
    it('initializes with enabled flag', () => {
      const protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
      });
      expect(protocol.enabled).toBe(true);
    });

    it('throws error if enabled but no secrets', () => {
      expect(() => {
        new WebhookAuthProtocol({
          enabled: true,
          secrets: {},
        });
      }).toThrow('At least one inbound webhook secret is required');
    });

    it('allows disabled without secrets', () => {
      const protocol = new WebhookAuthProtocol({
        enabled: false,
      });
      expect(protocol.enabled).toBe(false);
    });

    it('uses default tolerance and ttl', () => {
      const protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
      });
      expect(protocol.toleranceMs).toBe(DEFAULT_TOLERANCE_MS);
      expect(protocol.replayTtlMs).toBe(DEFAULT_REPLAY_TTL_MS);
    });

    it('uses custom tolerance and ttl', () => {
      const protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
        toleranceMs: 100000,
        replayTtlMs: 200000,
      });
      expect(protocol.toleranceMs).toBe(100000);
      expect(protocol.replayTtlMs).toBe(200000);
    });
  });

  describe('verify', () => {
    let protocol;

    beforeEach(() => {
      protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123', backup: 'secret456' },
        toleranceMs: 300000,
        replayTtlMs: 600000,
      });
    });

    it('returns error if webhooks disabled', () => {
      const disabledProtocol = new WebhookAuthProtocol({ enabled: false });
      const result = disabledProtocol.verify({
        method: 'POST',
        path: '/',
        headers: {},
        rawBody: '',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('webhooks_disabled');
      expect(result.status).toBe(404);
    });

    it('rejects body exceeding max bytes', () => {
      protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
        maxBodyBytes: 100,
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers: {},
        rawBody: 'x'.repeat(101),
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('body_too_large');
      expect(result.status).toBe(413);
    });

    it('rejects missing auth headers', () => {
      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers: {},
        rawBody: '',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_auth_headers');
      expect(result.status).toBe(401);
    });

    it('rejects invalid timestamp', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: '',
        timestamp: 'not-a-number',
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: '',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid_timestamp');
    });

    it('rejects timestamp outside tolerance window', () => {
      const now = Date.now();
      const oldTimestamp = now - 400000; // 400 seconds ago (> 300s tolerance)

      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: '',
        timestamp: oldTimestamp,
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: '',
        now,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('timestamp_out_of_window');
    });

    it('accepts timestamp within tolerance window', () => {
      const now = Date.now();
      const recentTimestamp = now - 60000; // 60 seconds ago (< 300s tolerance)

      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: '',
        timestamp: recentTimestamp,
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: '',
        now,
      });

      expect(result.ok).toBe(true);
    });

    it('rejects unknown key id', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: '',
        keyId: 'primary',
      });

      // Modify keyId to unknown value
      headers['x-sorotask-key-id'] = 'unknown';

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: '',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unknown_key_id');
    });

    it('rejects invalid signature', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'correct-body',
        keyId: 'primary',
      });

      // Modify body after signing
      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: 'wrong-body',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('accepts valid signature with primary key', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/webhooks/task-executions',
        body: '{"taskId": 123}',
        keyId: 'primary',
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/webhooks/task-executions',
        headers,
        rawBody: '{"taskId": 123}',
      });

      expect(result.ok).toBe(true);
      expect(result.keyId).toBe('primary');
    });

    it('accepts valid signature with backup key', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/webhooks/task-executions',
        body: '{"taskId": 123}',
        keyId: 'backup',
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/webhooks/task-executions',
        headers,
        rawBody: '{"taskId": 123}',
      });

      expect(result.ok).toBe(true);
      expect(result.keyId).toBe('backup');
    });

    it('prevents replay with same nonce and timestamp', () => {
      const now = Date.now();
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
        timestamp: now,
        nonce: 'fixed-nonce',
      });

      // First request should succeed
      const result1 = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: 'test',
        now,
      });
      expect(result1.ok).toBe(true);

      // Second request with same credentials should fail
      const result2 = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: 'test',
        now,
      });
      expect(result2.ok).toBe(false);
      expect(result2.reason).toBe('replay_detected');
    });

    it('allows request with different nonce', () => {
      const headers1 = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
        nonce: 'nonce1',
      });

      const headers2 = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
        nonce: 'nonce2',
      });

      const result1 = protocol.verify({
        method: 'POST',
        path: '/',
        headers: headers1,
        rawBody: 'test',
      });
      expect(result1.ok).toBe(true);

      const result2 = protocol.verify({
        method: 'POST',
        path: '/',
        headers: headers2,
        rawBody: 'test',
      });
      expect(result2.ok).toBe(true);
    });

    it('returns body hash in successful verification', () => {
      const body = '{"taskId": 123}';
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body,
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: body,
      });

      expect(result.ok).toBe(true);
      expect(result.bodyHash).toBeDefined();
      expect(result.bodyHash.length).toBe(64); // SHA256 hex is 64 chars
    });

    it('uses provided replay store', () => {
      const mockStore = {
        consume: jest.fn().mockReturnValue(true),
      };

      const protocol2 = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
        replayStore: mockStore,
      });

      const headers = protocol2.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
      });

      protocol2.verify({
        method: 'POST',
        path: '/',
        headers,
        rawBody: 'test',
      });

      expect(mockStore.consume).toHaveBeenCalled();
    });

    it('handles case-insensitive headers', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
      });

      // Convert headers to different case
      const mixedCaseHeaders = {};
      Object.entries(headers).forEach(([key, value]) => {
        mixedCaseHeaders[key.toUpperCase()] = value;
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers: mixedCaseHeaders,
        rawBody: 'test',
      });

      expect(result.ok).toBe(true);
    });

    it('handles array header values', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
      });

      // Convert headers to arrays (Express sometimes does this)
      const arrayHeaders = {};
      Object.entries(headers).forEach(([key, value]) => {
        arrayHeaders[key] = [value];
      });

      const result = protocol.verify({
        method: 'POST',
        path: '/',
        headers: arrayHeaders,
        rawBody: 'test',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('createTestHeaders', () => {
    let protocol;

    beforeEach(() => {
      protocol = new WebhookAuthProtocol({
        enabled: true,
        secrets: { primary: 'secret123' },
      });
    });

    it('generates valid headers for verification', () => {
      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/webhooks/task-executions',
        body: '{"test": true}',
      });

      expect(headers).toHaveProperty('x-sorotask-signature');
      expect(headers).toHaveProperty('x-sorotask-timestamp');
      expect(headers).toHaveProperty('x-sorotask-nonce');
      expect(headers).toHaveProperty('x-sorotask-key-id');
    });

    it('generates different nonces each time', () => {
      const headers1 = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
      });

      const headers2 = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
      });

      expect(headers1['x-sorotask-nonce']).not.toBe(headers2['x-sorotask-nonce']);
    });

    it('respects custom timestamp and nonce', () => {
      const timestamp = 12345;
      const nonce = 'custom-nonce';

      const headers = protocol.createTestHeaders({
        method: 'POST',
        path: '/',
        body: 'test',
        timestamp,
        nonce,
      });

      expect(headers['x-sorotask-timestamp']).toBe(String(timestamp));
      expect(headers['x-sorotask-nonce']).toBe(nonce);
    });
  });
});

describe('validateTaskExecutionPayload', () => {
  it('accepts valid task execution event', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 456,
      source: 'external',
    });

    expect(result.ok).toBe(true);
    expect(result.value.taskId).toBe(456);
    expect(result.value.eventId).toBe('evt-123');
  });

  it('rejects non-object payload', () => {
    expect(validateTaskExecutionPayload(null).ok).toBe(false);
    expect(validateTaskExecutionPayload('string').ok).toBe(false);
    expect(validateTaskExecutionPayload([1, 2, 3]).ok).toBe(false);
  });

  it('rejects wrong event type', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.create',
      eventId: 'evt-123',
      taskId: 456,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported_event_type');
  });

  it('rejects missing event id', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      taskId: 456,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_event_id');
  });

  it('rejects non-string event id', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 123,
      taskId: 456,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects invalid task id', () => {
    expect(validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: -1,
    }).ok).toBe(false);

    expect(validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 0,
    }).ok).toBe(false);

    expect(validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 'not-a-number',
    }).ok).toBe(false);

    expect(validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: Number.MAX_SAFE_INTEGER + 1,
    }).ok).toBe(false);
  });

  it('accepts optional fields with defaults', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 456,
    });

    expect(result.ok).toBe(true);
    expect(result.value.source).toBe('external');
    expect(result.value.reason).toBeNull();
    expect(result.value.metadata).toEqual({});
  });

  it('accepts custom metadata', () => {
    const metadata = { key: 'value', nested: { data: true } };
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 456,
      metadata,
    });

    expect(result.ok).toBe(true);
    expect(result.value.metadata).toEqual(metadata);
  });

  it('ignores non-object metadata', () => {
    const result = validateTaskExecutionPayload({
      type: 'task.execute',
      eventId: 'evt-123',
      taskId: 456,
      metadata: 'invalid',
    });

    expect(result.ok).toBe(true);
    expect(result.value.metadata).toEqual({});
  });
});

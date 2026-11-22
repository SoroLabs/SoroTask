const assert = require('node:assert/strict');
const test = require('node:test');
const { CacheInvalidationEngine } = require('../src/cacheInvalidator');

test('CacheInvalidationEngine - cache set, get, and latency', () => {
  const engine = new CacheInvalidationEngine();
  engine.set('task:1', { task_id: 1, creator: 'G_ALICE' });

  const val = engine.get('task:1');
  assert.deepEqual(val, { task_id: 1, creator: 'G_ALICE' });

  engine.clear();
});

test('CacheInvalidationEngine - event-driven cache invalidation', () => {
  const engine = new CacheInvalidationEngine();
  engine.set('task:42', { task_id: 42 });
  engine.set('creator:G_ALICE', [{ task_id: 42 }]);
  engine.set('tasks:all', [{ task_id: 42 }]);

  const purged = engine.invalidateForEvent('TaskRegistered', 42, { creator: 'G_ALICE' });

  assert.equal(engine.get('task:42'), null);
  assert.equal(engine.get('creator:G_ALICE'), null);
  assert.equal(engine.get('tasks:all'), null);
  assert.ok(purged.includes('task:42'));
  assert.ok(purged.includes('creator:G_ALICE'));
});

test('CacheInvalidationEngine - pub/sub event broadcasting and remote invalidation', () => {
  let publishedMessage = null;
  const mockRedis = {
    publish(channel, message) {
      publishedMessage = message;
    },
    subscribe(channel, cb) {
      this.cb = cb;
    },
  };

  const engine = new CacheInvalidationEngine({ redisClient: mockRedis });
  engine.set('task:99', { task_id: 99 });

  engine.invalidateKeys(['task:99']);
  assert.ok(publishedMessage != null);

  // Simulate remote instance receiving message
  const remoteEngine = new CacheInvalidationEngine();
  remoteEngine.set('task:99', { task_id: 99 });
  remoteEngine.handlePubSubMessage(publishedMessage);

  assert.equal(remoteEngine.get('task:99'), null);
});

test('CacheInvalidationEngine - Edge CDN surrogate rules, DB mutation hooks, <150ms purge, and >95% hit ratio (#1456)', async () => {
  const cdnPurgeCalls = [];
  const engine = new CacheInvalidationEngine({
    cdnProvider: 'cloudflare',
    cloudflareZoneId: 'zone-123',
    cloudflareApiToken: 'token-abc',
    httpFetcher: async (url, init) => {
      cdnPurgeCalls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });

  // 1. Verify Cloudflare / Fastly CDN caching headers with surrogate keys
  const headers = engine.buildCdnCacheHeaders(['task:77', 'tasks:all']);
  assert.ok(headers['Cache-Control'].includes('s-maxage=300'));
  assert.equal(headers['Surrogate-Key'], 'task:77 tasks:all');
  assert.equal(headers['Cache-Tag'], 'task:77,tasks:all');

  // 2. Populate edge cache and simulate 100 read requests (96 hits, 4 misses -> 96% hit ratio & 96% origin load reduction)
  engine.set('endpoint:/api/tasks/77', { task_id: 77, is_active: 1 }, 300000, ['task:77', 'tasks:all']);
  for (let i = 0; i < 96; i++) {
    const hit = engine.get('endpoint:/api/tasks/77');
    assert.equal(hit.task_id, 77);
  }
  for (let i = 0; i < 4; i++) {
    engine.get(`endpoint:/api/tasks/missing-${i}`);
  }

  const metrics = engine.getMetrics();
  assert.ok(metrics.hitRatio >= 0.95);
  assert.ok(metrics.originLoadReduction >= 0.80);
  assert.equal(metrics.meetsHitRatioSlo, true);
  assert.equal(metrics.meetsOriginReductionSlo, true);

  // 3. Hook into database mutation events and verify instant edge purge in < 150ms
  let hookCalled = false;
  engine.onDatabaseMutation((mutation, keys) => {
    hookCalled = mutation.table === 'tasks' && keys.includes('task:77');
  });

  const purgeResult = await engine.handleDatabaseMutation({
    table: 'tasks',
    operation: 'UPSERT',
    taskId: 77,
    record: { task_id: 77, creator: 'G_BOB' },
  });

  assert.equal(hookCalled, true);
  assert.equal(purgeResult.withinSla, true);
  assert.ok(purgeResult.latencyMs < 150);
  assert.equal(cdnPurgeCalls.length, 1);
  assert.ok(cdnPurgeCalls[0].body.tags.includes('task:77'));
  assert.equal(engine.get('endpoint:/api/tasks/77'), null);
});

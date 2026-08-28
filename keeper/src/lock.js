const Redis = require('ioredis');
const { createLogger } = require('./logger');
const crypto = require('crypto');

const logger = createLogger('locker');

class LockResult {
  /**
   * @param {object} opts
   * @param {string} opts.token
   * @param {number} opts.fencingToken
   * @param {string|number} opts.taskId
   * @param {number} opts.ttlMs
   */
  constructor({ token, fencingToken, taskId, ttlMs }) {
    this.token = String(token);
    this.fencingToken = Number(fencingToken);
    this.taskId = String(taskId);
    this.ttlMs = Number(ttlMs);
    this.acquiredAt = Date.now();
    this.expiresAt = this.acquiredAt + this.ttlMs;
  }

  toString() {
    return this.token;
  }

  valueOf() {
    return this.fencingToken;
  }

  [Symbol.toPrimitive](hint) {
    if (hint === 'number') {
      return this.fencingToken;
    }
    return this.token;
  }
}

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — distributed locking disabled (local-only)');
    // create a local in-memory shim with minimal API
    const map = new Map();
    const fencingMap = new Map();

    redisClient = {
      isLocalFallback: true,
      status: 'ready',
      async ping() {
        return 'PONG';
      },
      async set(key, value, mode, flag, ttlMs) {
        if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported local set signature');
        if (map.has(key)) return null;
        map.set(key, { value, expireAt: Date.now() + ttlMs });
        return 'OK';
      },
      async incr(key) {
        const val = (fencingMap.get(key) || 0) + 1;
        fencingMap.set(key, val);
        return val;
      },
      async eval(script, numKeys, ...args) {
        const key = args[0];
        const token = args[1];
        const ttlMs = args[2];

        // Lua compare and del
        if (script.includes('del')) {
          const entry = map.get(key);
          if (entry) {
            const raw = entry.value;
            if (raw === token || raw.startsWith(`${token}::`) || (typeof token === 'object' && token !== null && raw.startsWith(`${token.token}::`))) {
              map.delete(key);
              return 1;
            }
          }
          return 0;
        }

        // Lua pexpire
        if (script.includes('pexpire')) {
          const entry = map.get(key);
          if (entry) {
            const raw = entry.value;
            if (raw === token || raw.startsWith(`${token}::`) || (typeof token === 'object' && token !== null && raw.startsWith(`${token.token}::`))) {
              entry.expireAt = Date.now() + Number(ttlMs);
              return 1;
            }
          }
          return 0;
        }

        // Atomic acquire with monotonic fencing token script
        if (script.includes('keeper:lock:fencing') || (numKeys === 2 && script.includes('incr'))) {
          const fencingKey = args[1];
          const lockToken = args[2];
          const lockTtl = Number(args[3]);

          const entry = map.get(key);
          if (!entry || Date.now() > entry.expireAt) {
            const fence = (fencingMap.get(fencingKey) || 0) + 1;
            fencingMap.set(fencingKey, fence);
            map.set(key, {
              value: `${lockToken}::${fence}`,
              token: lockToken,
              fencingToken: fence,
              expireAt: Date.now() + lockTtl,
            });
            return [1, fence];
          }
          return [0, 0];
        }

        return 0;
      },
      async get(key) {
        const entry = map.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expireAt) {
          map.delete(key);
          return null;
        }
        return entry.value;
      },
      quit: async () => {},
    };
    return redisClient;
  }

  redisClient = new Redis(url);
  redisClient.isLocalFallback = false;
  redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  return redisClient;
}

class RedlockManager {
  /**
   * @param {Array<string|object>} [nodes] - Redis connection strings or clients
   * @param {object} [options]
   */
  constructor(nodes = [], options = {}) {
    this.nodes = nodes;
    this.logger = options.logger || logger;
    this.clients = [];
    this.taskFencingTokens = new Map();
    this._initClients();
  }

  _initClients() {
    if (this.nodes.length === 0) {
      const nodeStr = process.env.REDIS_NODES || process.env.REDIS_URL;
      if (nodeStr) {
        this.nodes = nodeStr.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    if (this.nodes.length === 0) {
      // In-memory mock nodes for 3-node quorum testing / fallback
      for (let i = 0; i < 3; i++) {
        const map = new Map();
        const fencingMap = new Map();

        this.clients.push({
          nodeId: `mock-node-${i + 1}`,
          isMock: true,
          async set(key, value, mode, flag, ttlMs) {
            if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported set signature');
            const entry = map.get(key);
            if (entry && Date.now() <= entry.expireAt) return null;
            map.set(key, { value, expireAt: Date.now() + Number(ttlMs) });
            return 'OK';
          },
          async incr(key) {
            const val = (fencingMap.get(key) || 0) + 1;
            fencingMap.set(key, val);
            return val;
          },
          async eval(script, numKeys, ...args) {
            const key = args[0];

            // Atomic acquire with monotonic fencing token script
            if (script.includes('keeper:lock:fencing') || (numKeys === 2 && script.includes('incr'))) {
              const fencingKey = args[1];
              const lockToken = args[2];
              const lockTtl = Number(args[3]);

              const entry = map.get(key);
              if (!entry || Date.now() > entry.expireAt) {
                const fence = (fencingMap.get(fencingKey) || 0) + 1;
                fencingMap.set(fencingKey, fence);
                map.set(key, {
                  value: `${lockToken}::${fence}`,
                  token: lockToken,
                  fencingToken: fence,
                  expireAt: Date.now() + lockTtl,
                });
                return [1, fence];
              }
              return [0, 0];
            }

            // Release script
            if (script.includes('del')) {
              const tokenArg = String(args[1]);
              const entry = map.get(key);
              if (entry) {
                const raw = String(entry.value);
                if (raw === tokenArg || raw.startsWith(`${tokenArg}::`) || tokenArg.startsWith(raw)) {
                  map.delete(key);
                  return 1;
                }
              }
              return 0;
            }

            // Extend script
            if (script.includes('pexpire')) {
              const tokenArg = String(args[1]);
              const ttlMs = Number(args[2]);
              const entry = map.get(key);
              if (entry) {
                const raw = String(entry.value);
                if (raw === tokenArg || raw.startsWith(`${tokenArg}::`) || tokenArg.startsWith(raw)) {
                  entry.expireAt = Date.now() + ttlMs;
                  return 1;
                }
              }
              return 0;
            }

            return 0;
          },
          async get(key) {
            const entry = map.get(key);
            if (!entry) return null;
            if (Date.now() > entry.expireAt) {
              map.delete(key);
              return null;
            }
            return entry.value;
          },
          quit: async () => {},
        });
      }
    } else {
      this.clients = this.nodes.map((target, idx) => {
        if (typeof target === 'object' && target !== null && typeof target.eval === 'function') {
          return target;
        }
        const url = typeof target === 'string' ? target : String(target);
        const client = new Redis(url);
        client.on('error', (err) => this.logger.error('Redlock Redis node error', { url, nodeIndex: idx, error: err.message }));
        return client;
      });
    }
  }

  /**
   * Acquire a distributed lock with a strictly monotonically increasing fencing token across quorum.
   * @param {string|number} taskId
   * @param {number} [ttlMs=60000]
   * @returns {Promise<LockResult|null>}
   */
  async acquire(taskId, ttlMs = 60000) {
    const id = String(taskId);
    const key = `keeper:lock:task:${id}`;
    const fencingKey = `keeper:lock:fencing:${id}`;
    const token = crypto.randomBytes(16).toString('hex');
    const quorum = Math.floor(this.clients.length / 2) + 1;

    // Lua script for atomic monotonic fencing generation & lock acquisition
    const acquireScript = `
      local current = redis.call('get', KEYS[1])
      if not current then
        local fence = redis.call('incr', KEYS[2])
        local val = ARGV[1] .. '::' .. tostring(fence)
        redis.call('set', KEYS[1], val, 'PX', ARGV[2])
        return { 1, fence }
      else
        return { 0, 0 }
      end
    `;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.eval(acquireScript, 2, key, fencingKey, token, ttlMs);
          if (Array.isArray(res) && res[0] === 1) {
            return { ok: true, fence: Number(res[1]) };
          }
          return { ok: false, fence: 0 };
        } catch (_err) {
          // Fallback if eval unsupported on older mocks
          try {
            const setRes = await client.set(key, token, 'PX', 'NX', ttlMs);
            if (setRes === 'OK') {
              const fence = typeof client.incr === 'function' ? await client.incr(fencingKey) : 1;
              return { ok: true, fence: Number(fence) };
            }
          } catch (_e) {}
          return { ok: false, fence: 0 };
        }
      })
    );

    const successfulNodes = results.filter((r) => r.ok);
    const acquiredCount = successfulNodes.length;

    if (acquiredCount >= quorum) {
      // Find the highest fencing token agreed across quorum nodes
      const maxFencingToken = Math.max(...successfulNodes.map((r) => r.fence), 1);
      this.taskFencingTokens.set(id, maxFencingToken);

      this.logger.info('Redlock acquired across quorum with fencing token', {
        taskId: id,
        fencingToken: maxFencingToken,
        acquiredCount,
        totalNodes: this.clients.length,
        quorum,
      });

      return new LockResult({
        token,
        fencingToken: maxFencingToken,
        taskId: id,
        ttlMs,
      });
    }

    // Quorum not reached: release any acquired nodes to avoid partial locks
    await this.release(id, token);
    this.logger.debug('Redlock quorum not reached', { taskId: id, acquiredCount, quorum });
    return null;
  }

  /**
   * Release lock across all cluster nodes only if token matches.
   * @param {string|number} taskId
   * @param {string|object} tokenOrHandle
   * @returns {Promise<boolean>}
   */
  async release(taskId, tokenOrHandle) {
    const id = String(taskId);
    const key = `keeper:lock:task:${id}`;
    const token = typeof tokenOrHandle === 'object' && tokenOrHandle !== null
      ? (tokenOrHandle.token || String(tokenOrHandle))
      : String(tokenOrHandle);

    const script = `
      local current = redis.call('get', KEYS[1])
      if current then
        if current == ARGV[1] or string.find(current, ARGV[1] .. '::', 1, true) == 1 then
          return redis.call('del', KEYS[1])
        end
      end
      return 0
    `;
    const quorum = Math.floor(this.clients.length / 2) + 1;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.eval(script, 1, key, token);
          return res === 1;
        } catch (_err) {
          return false;
        }
      })
    );

    const releasedCount = results.filter(Boolean).length;
    this.logger.info('Redlock release attempted', { taskId: id, releasedCount });
    return releasedCount >= quorum || releasedCount > 0;
  }

  /**
   * Extend lock TTL across cluster nodes if token matches.
   * @param {string|number} taskId
   * @param {string|object} tokenOrHandle
   * @param {number} [ttlMs=60000]
   * @returns {Promise<boolean>}
   */
  async extend(taskId, tokenOrHandle, ttlMs = 60000) {
    const id = String(taskId);
    const key = `keeper:lock:task:${id}`;
    const token = typeof tokenOrHandle === 'object' && tokenOrHandle !== null
      ? (tokenOrHandle.token || String(tokenOrHandle))
      : String(tokenOrHandle);

    const script = `
      local current = redis.call('get', KEYS[1])
      if current then
        if current == ARGV[1] or string.find(current, ARGV[1] .. '::', 1, true) == 1 then
          return redis.call('pexpire', KEYS[1], ARGV[2])
        end
      end
      return 0
    `;
    const quorum = Math.floor(this.clients.length / 2) + 1;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.eval(script, 1, key, token, ttlMs);
          return res === 1;
        } catch (_err) {
          return false;
        }
      })
    );

    const extendedCount = results.filter(Boolean).length;
    this.logger.info('Redlock extension attempted', { taskId: id, extendedCount });
    return extendedCount >= quorum;
  }

  /**
   * Validate whether a lock is currently active on a quorum of nodes.
   * @param {string|number} taskId
   * @param {string|object} tokenOrHandle
   * @returns {Promise<boolean>}
   */
  async validateLock(taskId, tokenOrHandle) {
    const id = String(taskId);
    const key = `keeper:lock:task:${id}`;
    const token = typeof tokenOrHandle === 'object' && tokenOrHandle !== null
      ? (tokenOrHandle.token || String(tokenOrHandle))
      : String(tokenOrHandle);

    const quorum = Math.floor(this.clients.length / 2) + 1;
    const checks = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const val = await client.get(key);
          if (!val) return false;
          return val === token || val.startsWith(`${token}::`);
        } catch (_e) {
          return false;
        }
      })
    );

    const validCount = checks.filter(Boolean).length;
    return validCount >= quorum;
  }

  /**
   * Check if a given fencing token is stale compared to the highest known token.
   * @param {string|number} taskId
   * @param {number} fencingToken
   * @returns {boolean}
   */
  isStaleFencingToken(taskId, fencingToken) {
    const id = String(taskId);
    const highest = this.taskFencingTokens.get(id) || 0;
    return Number(fencingToken) < highest;
  }

  /**
   * Get the latest known fencing token for a task.
   * @param {string|number} taskId
   * @returns {number}
   */
  getLatestFencingToken(taskId) {
    return this.taskFencingTokens.get(String(taskId)) || 0;
  }
}

let defaultRedlockManager = null;

function getRedlockManager(nodes = []) {
  if (!defaultRedlockManager || nodes.length > 0) {
    defaultRedlockManager = new RedlockManager(nodes);
  }
  return defaultRedlockManager;
}

// Acquire a lock for a task using RedlockManager. Returns a LockResult or null.
async function acquireLock(taskId, ttlMs = 60000) {
  const manager = getRedlockManager();
  return manager.acquire(taskId, ttlMs);
}

// Release lock only if token matches
async function releaseLock(taskId, token) {
  const manager = getRedlockManager();
  return manager.release(taskId, token);
}

// Extend lock TTL if token matches
async function extendLock(taskId, token, ttlMs = 60000) {
  const manager = getRedlockManager();
  return manager.extend(taskId, token, ttlMs);
}

async function acquireRedlock(taskId, ttlMs = 60000, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.acquire(taskId, ttlMs);
}

async function releaseRedlock(taskId, token, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.release(taskId, token);
}

async function extendRedlock(taskId, token, ttlMs = 60000, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.extend(taskId, token, ttlMs);
}

module.exports = {
  LockResult,
  acquireLock,
  releaseLock,
  extendLock,
  getRedisClient,
  RedlockManager,
  getRedlockManager,
  acquireRedlock,
  releaseRedlock,
  extendRedlock,
};

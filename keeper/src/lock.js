const Redis = require('ioredis');
const { createLogger } = require('./logger');
const crypto = require('crypto');

const logger = createLogger('locker');

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — distributed locking disabled (local-only)');
    // create a local in-memory shim with minimal API
    const map = new Map();
    redisClient = {
      async set(key, value, mode, flag, ttlMs) {
        if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported local set signature');
        if (map.has(key)) return null;
        map.set(key, { value, expireAt: Date.now() + ttlMs });
        return 'OK';
      },
      async eval(script, numKeys, key, token) {
        // simple compare-and-del
        const entry = map.get(key);
        if (entry && entry.value === token) {
          map.delete(key);
          return 1;
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
  redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  return redisClient;
}

// Acquire a lock for a task. Returns a token string when acquired, or null.
async function acquireLock(taskId, ttlMs = 60000) {
  const key = `keeper:lock:task:${taskId}`;
  const token = crypto.randomBytes(16).toString('hex');
  const client = getRedisClient();

  try {
    const res = await client.set(key, token, 'PX', 'NX', ttlMs);
    if (res === 'OK') {
      logger.info('Lock acquired', { taskId, ttlMs });
      return token;
    }
    logger.debug('Lock contention', { taskId });
    return null;
  } catch (err) {
    logger.error('Failed to acquire lock', { taskId, error: err.message });
    return null;
  }
}

// Release lock only if token matches
async function releaseLock(taskId, token) {
  const key = `keeper:lock:task:${taskId}`;
  const client = getRedisClient();

  // Lua script: if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  try {
    const res = await client.eval(script, 1, key, token);
    if (res === 1) {
      logger.info('Lock released', { taskId });
      return true;
    }
    logger.warn('Failed to release lock — token mismatch or expired', { taskId });
    return false;
  } catch (err) {
    logger.error('Failed to release lock', { taskId, error: err.message });
    return false;
  }
}

// Extend lock TTL if token matches
async function extendLock(taskId, token, ttlMs = 60000) {
  const key = `keeper:lock:task:${taskId}`;
  const client = getRedisClient();

  // Use a Lua script to check token and PEXPIRE
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
  try {
    const res = await client.eval(script, 1, key, token, ttlMs);
    if (res === 1) {
      logger.info('Lock extended', { taskId, ttlMs });
      return true;
    }
    logger.warn('Failed to extend lock — token mismatch or expired', { taskId });
    return false;
  } catch (err) {
    logger.error('Failed to extend lock', { taskId, error: err.message });
    return false;
  }
}

module.exports = { acquireLock, releaseLock, extendLock, getRedisClient };

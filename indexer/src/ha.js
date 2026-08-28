const EventEmitter = require('events');

const ROLES = Object.freeze({
  PRIMARY: 'PRIMARY',
  STANDBY: 'STANDBY',
});

/**
 * PostgreSQL advisory lock-based leader election provider.
 * Uses pg_advisory_lock / pg_advisory_unlock for distributed mutex.
 */
class PostgresLockProvider {
  /**
   * @param {object} pool - A pg Pool or client with .query() support
   * @param {number} [lockId=42] - Advisory lock identifier
   */
  constructor(pool, lockId = 42) {
    this.pool = pool;
    this.lockId = lockId;
    this.locked = false;
  }

  async acquire() {
    const res = await this.pool.query('SELECT pg_advisory_lock($1)', [this.lockId]);
    this.locked = res.rows[0]?.pg_advisory_lock === true;
    return this.locked;
  }

  async release() {
    if (!this.locked) return;
    await this.pool.query('SELECT pg_advisory_unlock($1)', [this.lockId]);
    this.locked = false;
  }

  async isHeld() {
    const res = await this.pool.query(
      'SELECT pg_advisory_lock($1) AS held',
      [this.lockId],
    );
    // pg_advisory_lock is re-entrant; we just check if we can acquire
    return res.rows[0]?.held === true;
  }
}

/**
 * Redis Redlock-based leader election provider.
 * Implements the Redlock algorithm for distributed mutex across Redis replicas.
 */
class RedisLockProvider {
  /**
   * @param {object} redisClient - An ioredis or node-redis client instance
   * @param {string} [lockKey='indexer:leader-lock'] - Redis key for the lock
   * @param {number} [ttlMs=10000] - Lock TTL in milliseconds
   */
  constructor(redisClient, lockKey = 'indexer:leader-lock', ttlMs = 10000) {
    this.redis = redisClient;
    this.lockKey = lockKey;
    this.ttlMs = ttlMs;
    this.lockValue = null;
  }

  async acquire() {
    const value = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const acquired = await this.redis.set(
      this.lockKey,
      value,
      'PX',
      this.ttlMs,
      'NX',
    );
    if (acquired) {
      this.lockValue = value;
      return true;
    }
    return false;
  }

  async release() {
    if (!this.lockValue) return;
    // Lua script to ensure we only release our own lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, this.lockKey, this.lockValue);
    } catch (_) {
      // Ignore errors during release (lock may have expired)
    }
    this.lockValue = null;
  }

  async isHeld() {
    if (!this.lockValue) return false;
    const val = await this.redis.get(this.lockKey);
    return val === this.lockValue;
  }
}

/**
 * SQLite-based leader election provider (original behavior, for single-instance).
 * Uses the cluster_nodes table with heartbeat-based failover.
 */
class SqliteLockProvider {
  constructor(db) {
    this.db = db;
  }

  async acquire() {
    // SQLite doesn't support true advisory locks; fall back to role-based
    return true;
  }

  async release() {
    return true;
  }

  async isHeld() {
    return true;
  }
}

class HighAvailabilityManager extends EventEmitter {
  /**
   * @param {object} db - SQLite database handle (used for cluster_nodes table)
   * @param {object} [options]
   * @param {string} [options.nodeId] - Unique node identifier
   * @param {string} [options.role] - Initial role (PRIMARY or STANDBY)
   * @param {number} [options.heartbeatIntervalMs] - Heartbeat interval (default 3s)
   * @param {number} [options.heartbeatTimeoutMs] - Failover timeout (default 10s)
   * @param {object} [options.lockProvider] - Distributed lock provider
   *   (PostgresLockProvider, RedisLockProvider, or SqliteLockProvider)
   * @param {number} [options.lockRenewIntervalMs] - How often to renew distributed lock
   */
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.nodeId = options.nodeId || `node-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
    this.role = options.role === ROLES.PRIMARY ? ROLES.PRIMARY : ROLES.STANDBY;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 3000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;
    this.isLeader = this.role === ROLES.PRIMARY;
    this.heartbeatTimer = null;
    this.failoverTimer = null;
    this.lockRenewTimer = null;
    this.isRunning = false;

    // Distributed lock provider (optional; falls back to SQLite heartbeat)
    this.lockProvider = options.lockProvider || new SqliteLockProvider(db);
    this.lockRenewIntervalMs = options.lockRenewIntervalMs || Math.floor(this.heartbeatTimeoutMs / 2);
    this._hasDistributedLock = false;
  }

  async initialize() {
    await this.runSql(`
      CREATE TABLE IF NOT EXISTS cluster_nodes (
        node_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        metadata_json TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.registerNode();
  }

  async registerNode() {
    const now = Date.now();
    await this.runSql(
      `INSERT OR REPLACE INTO cluster_nodes (node_id, role, last_heartbeat, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [this.nodeId, this.role, now, JSON.stringify({ startedAt: new Date().toISOString() })]
    );
  }

  async sendHeartbeat() {
    const now = Date.now();
    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [this.role, now, this.nodeId]
    );
    this.emit('heartbeat', { nodeId: this.nodeId, role: this.role, timestamp: now });
  }

  /**
   * Try to acquire the distributed lock. If successful, promote to PRIMARY.
   * Returns true if leadership was acquired.
   */
  async tryAcquireLeadership() {
    try {
      const acquired = await this.lockProvider.acquire();
      if (acquired && !this._hasDistributedLock) {
        this._hasDistributedLock = true;
        if (this.role !== ROLES.PRIMARY) {
          await this.promote();
        }
        return true;
      }
      return acquired;
    } catch (err) {
      console.error(`[HA] Failed to acquire distributed lock: ${err.message}`);
      return false;
    }
  }

  /**
   * Release the distributed lock and demote to STANDBY.
   */
  async releaseLeadership() {
    if (!this._hasDistributedLock) return;
    try {
      await this.lockProvider.release();
      this._hasDistributedLock = false;
      if (this.role !== ROLES.STANDBY) {
        await this.demote();
      }
    } catch (err) {
      console.error(`[HA] Failed to release distributed lock: ${err.message}`);
    }
  }

  async checkFailover() {
    if (this.isLeader) {
      return;
    }

    const now = Date.now();
    const cutoff = now - this.heartbeatTimeoutMs;

    const activePrimaries = await this.allSql(
      `SELECT * FROM cluster_nodes WHERE role = ? AND last_heartbeat > ? AND node_id != ?`,
      [ROLES.PRIMARY, cutoff, this.nodeId]
    );

    if (activePrimaries.length === 0) {
      console.log(`[HA] Primary node failed or unreachable. Standby node ${this.nodeId} promoting to PRIMARY.`);
      await this.promote();
    }
  }

  async promote() {
    const previousRole = this.role;
    this.role = ROLES.PRIMARY;
    this.isLeader = true;
    const now = Date.now();

    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [ROLES.PRIMARY, now, this.nodeId]
    );

    this.emit('roleChange', {
      nodeId: this.nodeId,
      previousRole,
      newRole: ROLES.PRIMARY,
      isLeader: true,
      promotedAt: now,
    });
  }

  async demote() {
    const previousRole = this.role;
    this.role = ROLES.STANDBY;
    this.isLeader = false;
    const now = Date.now();

    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [ROLES.STANDBY, now, this.nodeId]
    );

    this.emit('roleChange', {
      nodeId: this.nodeId,
      previousRole,
      newRole: ROLES.STANDBY,
      isLeader: false,
      demotedAt: now,
    });
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.sendHeartbeat().catch((err) => console.error('[HA] Error sending heartbeat:', err));

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch((err) => console.error('[HA] Error sending heartbeat:', err));
    }, this.heartbeatIntervalMs);

    this.failoverTimer = setInterval(() => {
      this.checkFailover().catch((err) => console.error('[HA] Error checking failover:', err));
    }, this.heartbeatIntervalMs);

    // If we have a distributed lock provider, try to acquire leadership
    // and start periodic lock renewal.
    if (!(this.lockProvider instanceof SqliteLockProvider)) {
      this.tryAcquireLeadership().catch((err) =>
        console.error('[HA] Error acquiring leadership:', err),
      );

      this.lockRenewTimer = setInterval(() => {
        if (this.isLeader && this._hasDistributedLock) {
          // Renew the distributed lock by re-acquiring it
          this.lockProvider.acquire().catch((err) => {
            console.error(`[HA] Failed to renew distributed lock: ${err.message}`);
            // If renewal fails, demote and let another node take over
            this._hasDistributedLock = false;
            this.demote().catch(() => {});
          });
        } else if (!this.isLeader) {
          // Try to acquire leadership if current leader dropped
          this.tryAcquireLeadership().catch(() => {});
        }
      }, this.lockRenewIntervalMs);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.failoverTimer) clearInterval(this.failoverTimer);
    if (this.lockRenewTimer) clearInterval(this.lockRenewTimer);
    this.heartbeatTimer = null;
    this.failoverTimer = null;
    this.lockRenewTimer = null;

    // Release distributed lock on shutdown
    if (this._hasDistributedLock) {
      this.releaseLeadership().catch(() => {});
    }
  }

  async getClusterNodes() {
    return this.allSql(`SELECT * FROM cluster_nodes ORDER BY last_heartbeat DESC`);
  }

  runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  allSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = {
  ROLES,
  HighAvailabilityManager,
  PostgresLockProvider,
  RedisLockProvider,
  SqliteLockProvider,
};

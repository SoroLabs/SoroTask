const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createLogger } = require("./logger");

function parseIntOrDefault(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class ExecutionIdempotencyGuard {
  constructor(options = {}) {
    this.logger = options.logger || createLogger("idempotency");
    this.lockTtlMs = parseIntOrDefault(
      options.lockTtlMs || process.env.EXECUTION_LOCK_TTL_MS,
      120000,
    );
    this.completedTtlMs = parseIntOrDefault(
      options.completedTtlMs || process.env.EXECUTION_COMPLETED_MARKER_TTL_MS,
      30000,
    );

    const stateDir =
      options.stateDir ||
      process.env.KEEPER_STATE_DIR ||
      path.join(process.cwd(), "data");
    this.stateFile =
      options.stateFile ||
      process.env.IDEMPOTENCY_STATE_FILE ||
      path.join(stateDir, "execution_locks.json");

    this.state = { version: 1, locks: {} };
    this._loadState();
    this.cleanupExpired();
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return;
      }

      const raw = fs.readFileSync(this.stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.locks &&
        typeof parsed.locks === "object"
      ) {
        this.state = { version: 1, locks: parsed.locks };
      }
    } catch (error) {
      this.logger.warn(
        "Failed to load idempotency state file, starting fresh",
        {
          stateFile: this.stateFile,
          error: error.message,
        },
      );
      this.state = { version: 1, locks: {} };
    }
  }

  _persistState() {
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tempPath, this.stateFile);
  }

  _newAttemptId(taskId) {
    const rand = crypto.randomBytes(6).toString("hex");
    return `task-${taskId}-${Date.now()}-${rand}`;
  }

  cleanupExpired(now = Date.now()) {
    let removed = 0;

    Object.keys(this.state.locks).forEach((taskId) => {
      const lock = this.state.locks[taskId];
      if (!lock || lock.expiresAt <= now) {
        delete this.state.locks[taskId];
        removed += 1;
      }
    });

    if (removed > 0) {
      this._persistState();
      this.logger.info("Cleaned up expired idempotency locks", { removed });
    }

    return removed;
  }

  acquire(taskId, metadata = {}) {
    const now = Date.now();
    this.cleanupExpired(now);

    const key = String(taskId);
    const existing = this.state.locks[key];
    if (existing) {
      return {
        acquired: false,
        reason: "locked",
        attemptId: existing.attemptId,
        lock: existing,
      };
    }

    const attemptId = metadata.attemptId || this._newAttemptId(taskId);
    const lock = {
      taskId,
      attemptId,
      status: "in_progress",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.lockTtlMs,
      retries: 0,
      lastError: null,
    };

    this.state.locks[key] = lock;
    this._persistState();

    return {
      acquired: true,
      reason: "acquired",
      attemptId,
      lock,
    };
  }

  touchRetry(taskId, details = {}) {
    const key = String(taskId);
    const lock = this.state.locks[key];
    if (!lock) return null;

    lock.updatedAt = Date.now();
    lock.expiresAt = lock.updatedAt + this.lockTtlMs;
    lock.status = "retrying";
    lock.retries = details.retries != null ? details.retries : lock.retries + 1;
    if (details.lastError) {
      lock.lastError = details.lastError;
    }

    this._persistState();
    return lock;
  }

  markCompleted(taskId, details = {}) {
    const key = String(taskId);
    const lock = this.state.locks[key];
    if (!lock) return null;

    const now = Date.now();
    lock.updatedAt = now;
    lock.status = details.status || "completed";
    lock.txHash = details.txHash || lock.txHash || null;
    lock.expiresAt = now + this.completedTtlMs;

    this._persistState();
    return lock;
  }

  markFailed(taskId, details = {}) {
    const key = String(taskId);
    const lock = this.state.locks[key];
    if (!lock) return null;

    const now = Date.now();
    lock.updatedAt = now;
    lock.status = details.status || "failed";
    lock.lastError = details.lastError || lock.lastError || null;
    lock.expiresAt = now + this.lockTtlMs;

    this._persistState();
    return lock;
  }

  release(taskId) {
    const key = String(taskId);
    if (this.state.locks[key]) {
      delete this.state.locks[key];
      this._persistState();
      return true;
    }
    return false;
  }

  getLock(taskId) {
    this.cleanupExpired();
    return this.state.locks[String(taskId)] || null;
  }

  getSnapshot() {
    this.cleanupExpired();
    return {
      stateFile: this.stateFile,
      lockTtlMs: this.lockTtlMs,
      completedTtlMs: this.completedTtlMs,
      lockCount: Object.keys(this.state.locks).length,
      locks: { ...this.state.locks },
    };
  }
}

module.exports = { ExecutionIdempotencyGuard };

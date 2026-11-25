'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('./logger');

const SNAPSHOT_VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, 2]);

/**
 * Dedicated snapshot manager for TaskRegistry persistence.
 *
 * Improvements over the legacy inline save/load:
 *  - Atomic writes: serialise to `<file>.tmp` then rename — process crashes mid-write
 *    leave the previous snapshot intact rather than producing a corrupt file.
 *  - Dual staleness: rejects snapshots stale by ledger gap OR wall-clock age.
 *  - SHA-256 checksum: 16-hex-char integrity prefix detects partial writes and
 *    filesystem corruption without adding meaningful overhead.
 *  - v1 → v2 migration: forward-compatible loading of legacy snapshots.
 *
 * Time complexity:
 *   save / loadSync : O(n) — single JSON serialise/parse pass over n tasks
 *   isStale         : O(1)
 *   _checksum       : O(n) — single SHA-256 pass over serialised body
 *
 * Space complexity: O(n) for the serialised payload.
 */
class TaskSnapshot {
  /**
   * @param {object} [options]
   * @param {string} [options.dir]                   Directory for snapshot file. Default: `<module root>/data`
   * @param {string} [options.filename]              Snapshot filename. Default: `tasks.json`
   * @param {number} [options.staleThresholdLedgers] Max ledger gap before snapshot is stale. Default: 100 000
   * @param {number} [options.staleThresholdMs]      Max wall-clock age in ms before stale (0 = disabled). Default: 0
   * @param {object} [options.logger]                Pino-compatible logger
   */
  constructor(options = {}) {
    const dir = options.dir || path.join(__dirname, '..', 'data');
    this._filePath = path.join(dir, options.filename || 'tasks.json');
    this._tmpPath = `${this._filePath}.tmp`;
    this.staleThresholdLedgers = options.staleThresholdLedgers ?? 100_000;
    this.staleThresholdMs = options.staleThresholdMs ?? 0; // 0 = wall-clock check disabled
    this.logger = options.logger || createLogger('snapshot');

    // Incremental stats — O(1) space, never reset
    this._saves = 0;
    this._loads = 0;
    this._lastSaveMs = 0;
    this._lastLoadMs = 0;
    this._checksumErrors = 0;
    this._migrations = 0;

    // Ensure the data directory exists (idempotent with { recursive: true })
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Atomically persist registry state to disk.
   *
   * Write sequence: serialise → writeFile(tmp) → rename(tmp → final).
   * A crash between writeFile and rename leaves the previous snapshot intact.
   *
   * @param {{ taskIds: Set<number>, tasks: Map<number, object>, lastSeenLedger: number }} state
   * @returns {Promise<void>}
   */
  async save(state) {
    const payload = {
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      lastSeenLedger: state.lastSeenLedger,
      taskIds: Array.from(state.taskIds).sort((a, b) => a - b),
      tasks: Object.fromEntries(state.tasks),
    };

    // Compute checksum over the payload body (before the checksum field exists)
    const body = JSON.stringify(payload, null, 2);
    const full = JSON.stringify({ ...payload, checksum: this._checksum(body) }, null, 2);

    await fs.promises.writeFile(this._tmpPath, full, 'utf-8');
    await fs.promises.rename(this._tmpPath, this._filePath);

    this._saves++;
    this._lastSaveMs = Date.now();
  }

  /**
   * Synchronously load snapshot from disk (safe to call from a constructor).
   *
   * Returns `null` on: missing file, parse error, unsupported version, checksum failure.
   *
   * v1 snapshots are migrated to v2 format.  Because v1 has no `savedAt` timestamp the
   * wall-clock staleness check is skipped (`savedAt = null`) for the current boot cycle.
   *
   * @returns {{ version: number, savedAt: number|null, lastSeenLedger: number, taskIds: number[], tasks: object } | null}
   */
  loadSync() {
    if (!fs.existsSync(this._filePath)) return null;

    let raw;
    try {
      raw = fs.readFileSync(this._filePath, 'utf-8');
    } catch (err) {
      this.logger.warn('Snapshot read error', { error: err.message });
      return null;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.logger.warn('Snapshot parse error', { error: err.message });
      return null;
    }

    if (!SUPPORTED_VERSIONS.has(data.version)) {
      this.logger.warn('Unsupported snapshot version, discarding', { version: data.version });
      return null;
    }

    const loaded = data.version < SNAPSHOT_VERSION ? this._migrate(data) : data;

    if (!this._verifyChecksum(loaded)) {
      this._checksumErrors++;
      this.logger.warn('Snapshot checksum mismatch, discarding');
      return null;
    }

    this._loads++;
    this._lastLoadMs = Date.now();
    return loaded;
  }

  /**
   * Determine whether a snapshot is too stale to bootstrap from.
   *
   * A snapshot is stale when the ledger gap exceeds `staleThresholdLedgers`.
   * When `staleThresholdMs > 0` AND `meta.savedAt` is a valid timestamp, the snapshot
   * is also considered stale if its wall-clock age exceeds `staleThresholdMs`.
   *
   * @param {{ lastSeenLedger: number, savedAt: number|null }} meta
   * @param {number} currentLedger
   * @param {number} [nowMs=Date.now()]
   * @returns {boolean}
   */
  isStale(meta, currentLedger, nowMs = Date.now()) {
    const ledgerGap = currentLedger - (meta.lastSeenLedger || 0);
    if (ledgerGap > this.staleThresholdLedgers) return true;

    if (this.staleThresholdMs > 0 && meta.savedAt != null) {
      if (nowMs - meta.savedAt > this.staleThresholdMs) return true;
    }

    return false;
  }

  /**
   * Returns an O(1) stats snapshot for observability.
   *
   * @returns {{ saves: number, loads: number, lastSaveMs: number, lastLoadMs: number, checksumErrors: number, migrations: number }}
   */
  getStats() {
    return {
      saves: this._saves,
      loads: this._loads,
      lastSaveMs: this._lastSaveMs,
      lastLoadMs: this._lastLoadMs,
      checksumErrors: this._checksumErrors,
      migrations: this._migrations,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Compute a 16-hex-char prefix of SHA-256 over `body`.
   * Used for integrity verification only — not a security primitive.
   * O(n) in body length.
   *
   * @param {string} body - JSON string (must not include the `checksum` key)
   * @returns {string}
   */
  _checksum(body) {
    return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  }

  /**
   * Verify the checksum embedded in `data` by recomputing over the payload
   * without the `checksum` field.
   *
   * Returns `true` when `checksum` is absent so that v1-migrated snapshots
   * (which have no checksum) are trusted on the first boot after migration.
   *
   * @param {object} data - Parsed snapshot object (may or may not have `checksum`)
   * @returns {boolean}
   */
  _verifyChecksum(data) {
    const { checksum, ...rest } = data;
    if (!checksum) return true; // absent → trust (v1 migrated snapshots)
    return checksum === this._checksum(JSON.stringify(rest, null, 2));
  }

  /**
   * Promote a v1 snapshot to v2 format in-memory.
   *
   * `savedAt` is set to `null` rather than the v1 `updatedAt` ISO string because
   * setting it to 0 (epoch) would cause the wall-clock check to always fire, wiping
   * otherwise valid snapshots.  With `null`, `isStale()` skips the wall-clock test.
   *
   * @param {object} data - Parsed v1 snapshot
   * @returns {object}      v2-compatible snapshot object
   */
  _migrate(data) {
    this._migrations++;
    // Drop v1-only fields; v2 uses numeric `savedAt`
    const { updatedAt, checksum, ...rest } = data; // eslint-disable-line no-unused-vars
    return {
      ...rest,
      version: SNAPSHOT_VERSION,
      savedAt: null,
    };
  }
}

module.exports = TaskSnapshot;

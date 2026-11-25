/**
 * LedgerGapDetector — detects gaps in the processed ledger sequence and
 * triggers Redis cache invalidation when continuity is broken.
 *
 * A gap means the indexer missed one or more ledgers, so any cached data
 * derived from the event stream may be stale and must be flushed.
 */
class LedgerGapDetector {
  /**
   * @param {object} options
   * @param {object|null} options.cacheInvalidator - CacheInvalidationEngine instance
   * @param {number} options.maxAllowedGap - sequences skipped before declaring a gap (default: 1)
   * @param {Function} options.onGap - optional callback(gapInfo) fired on gap detection
   */
  constructor(options = {}) {
    this.cacheInvalidator = options.cacheInvalidator || null;
    this.maxAllowedGap = options.maxAllowedGap ?? 1;
    this.onGap = typeof options.onGap === 'function' ? options.onGap : null;
    this._lastProcessedSequence = null;
    this._gapCount = 0;
  }

  /**
   * Record the most recent successfully processed ledger sequence.
   * Call this once per poll cycle after events from `sequence` are handled.
   *
   * @param {number} sequence - ledger sequence number that was just processed
   * @returns {{ gap: boolean, gapSize: number, from: number|null, to: number }}
   */
  record(sequence) {
    const previous = this._lastProcessedSequence;
    const result = { gap: false, gapSize: 0, from: previous, to: sequence };

    if (previous !== null) {
      const delta = sequence - previous;
      if (delta > this.maxAllowedGap) {
        result.gap = true;
        result.gapSize = delta - 1;
        this._gapCount += 1;

        console.warn(
          `[LedgerGapDetector] Gap detected: ledgers ${previous + 1}–${sequence - 1} ` +
          `(${result.gapSize} missing). Invalidating cache.`
        );

        this._invalidateCache(result);

        if (this.onGap) {
          try {
            this.onGap(result);
          } catch (err) {
            console.error('[LedgerGapDetector] onGap callback threw:', err.message);
          }
        }
      }
    }

    this._lastProcessedSequence = sequence;
    return result;
  }

  /**
   * Flush all cache entries that could be affected by a ledger gap.
   * Clears the entire local cache and publishes a wildcard invalidation
   * via Redis pub/sub so all nodes flush simultaneously.
   *
   * @param {object} gapInfo
   */
  _invalidateCache(gapInfo) {
    if (!this.cacheInvalidator) return;

    // Flush known high-level keys that aggregate ledger-derived state
    const patternKeys = ['tasks:all', 'tasks:active', 'tasks:pending'];
    this.cacheInvalidator.invalidateKeys(patternKeys);

    // Also clear the entire local in-process cache — safest under a gap
    if (typeof this.cacheInvalidator.clear === 'function') {
      this.cacheInvalidator.clear();
    }

    console.info(
      `[LedgerGapDetector] Cache invalidated for gap from ledger ${gapInfo.from} to ${gapInfo.to}.`
    );
  }

  /** Reset the tracked sequence (e.g. on indexer restart). */
  reset() {
    this._lastProcessedSequence = null;
  }

  /** Total gaps detected since construction. */
  get gapCount() {
    return this._gapCount;
  }

  /** Last processed ledger sequence (null if none yet). */
  get lastProcessedSequence() {
    return this._lastProcessedSequence;
  }
}

module.exports = { LedgerGapDetector };

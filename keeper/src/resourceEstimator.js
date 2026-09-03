'use strict';

/**
 * resourceEstimator.js - pre-flight Soroban resource limit checks and fee
 * buffering (Issue #1059).
 *
 * # The failure
 *
 * Soroban caps each transaction on CPU instructions, memory, and bytes
 * read/written. A task with heavy dynamic arguments can exceed one of those
 * caps. The keeper finds out by submitting: the transaction is rejected
 * on-chain, the fee is spent, and the task is marked failed with whatever
 * opaque code the host returned. Simulation already reports the resource
 * figures - nothing was reading them.
 *
 * # Why 85%, and why a fee buffer on top
 *
 * Two different sources of drift, needing two different guards.
 *
 * *Resource usage* drifts because simulation runs against the current ledger
 * while execution happens a few ledgers later, against slightly different
 * state - a larger map, one more entry to scan. A transaction simulated at 99%
 * of the instruction cap is a coin flip. The 85% ceiling is the headroom for
 * that drift; anything above it is rejected before submission, where rejection
 * is free.
 *
 * *Fees* drift because the network's resource fee rate moves with congestion
 * between simulation and inclusion. That does not risk exceeding a limit, it
 * risks the transaction being rejected as underfunded - so it is answered by
 * paying a little more (+10%) rather than by refusing to send.
 *
 * The limits below are protocol parameters, not constants of nature: they are
 * network settings and have changed across protocol versions. They are
 * overridable for exactly that reason, and should be checked against the
 * network's current config rather than trusted indefinitely.
 */

/** Per-transaction ceilings. Override to match the target network. */
const DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  cpuInstructions: 100_000_000,
  memoryBytes: 41_943_040, // 40 MiB
  readBytes: 133_120,
  writeBytes: 66_560,
  readLedgerEntries: 40,
  writeLedgerEntries: 25,
});

/** Fraction of each limit a transaction may use and still be submitted. */
const DEFAULT_SAFETY_THRESHOLD = 0.85;

/** Multiplier applied to the simulated resource fee before submission. */
const DEFAULT_FEE_BUFFER = 1.1;

/** Human-readable units, used only for log and error text. */
const RESOURCE_UNITS = Object.freeze({
  cpuInstructions: 'instructions',
  memoryBytes: 'bytes',
  readBytes: 'bytes',
  writeBytes: 'bytes',
  readLedgerEntries: 'entries',
  writeLedgerEntries: 'entries',
});

class ResourceLimitExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ResourceLimitExceededError';
    this.code = 'RESOURCE_LIMIT_EXCEEDED';
    Object.assign(this, details);
  }
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  // Soroban XDR accessors often return BigInt or an object with a numeric
  // accessor; normalise all of them rather than trusting one shape.
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') return toNumber(value.toNumber(), fallback);
    if (typeof value.toString === 'function') {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Pull resource figures out of a simulation response.
 *
 * The shape varies by SDK version and by whether the caller passes the raw
 * JSON-RPC result or a parsed `SorobanTransactionData`, so every known
 * spelling is accepted. Returning zeros for an unrecognised shape would mean
 * silently reporting "uses no resources", so `extracted` records whether
 * anything was actually found and the caller can refuse to proceed blind.
 */
function extractResources(simulation) {
  const empty = {
    cpuInstructions: 0,
    memoryBytes: 0,
    readBytes: 0,
    writeBytes: 0,
    readLedgerEntries: 0,
    writeLedgerEntries: 0,
    resourceFee: 0,
    extracted: false,
  };

  if (!simulation || typeof simulation !== 'object') return empty;

  const data =
    simulation.sorobanTransactionData ||
    simulation.transactionData ||
    simulation.data ||
    simulation;

  // `transactionData` is sometimes a builder exposing .build(), sometimes the
  // XDR object itself.
  const built = typeof data?.build === 'function' ? data.build() : data;
  const resources =
    (typeof built?.resources === 'function' ? built.resources() : built?.resources) || built;

  const readEntries =
    resources?.footprint?.readOnly?.length ??
    resources?.readOnlyEntries ??
    resources?.readLedgerEntries;
  const writeEntries =
    resources?.footprint?.readWrite?.length ??
    resources?.readWriteEntries ??
    resources?.writeLedgerEntries;

  const cpu = resources?.instructions ?? resources?.cpuInsns ?? resources?.cpu_insns;
  const mem = resources?.memBytes ?? resources?.mem_bytes ?? resources?.memoryBytes;
  const read =
    resources?.readBytes ?? resources?.read_bytes ?? resources?.diskReadBytes;
  const write = resources?.writeBytes ?? resources?.write_bytes;

  const fee =
    simulation.minResourceFee ??
    simulation.min_resource_fee ??
    built?.resourceFee ??
    (typeof built?.resourceFee === 'function' ? built.resourceFee() : undefined);

  const out = {
    cpuInstructions: toNumber(typeof cpu === 'function' ? cpu.call(resources) : cpu),
    memoryBytes: toNumber(typeof mem === 'function' ? mem.call(resources) : mem),
    readBytes: toNumber(typeof read === 'function' ? read.call(resources) : read),
    writeBytes: toNumber(typeof write === 'function' ? write.call(resources) : write),
    readLedgerEntries: toNumber(readEntries),
    writeLedgerEntries: toNumber(writeEntries),
    resourceFee: toNumber(fee),
    extracted: false,
  };

  out.extracted = [cpu, mem, read, write, fee].some(
    (v) => v !== undefined && v !== null
  );

  return out;
}

class ResourceEstimator {
  constructor(options = {}) {
    this.limits = { ...DEFAULT_PROTOCOL_LIMITS, ...(options.limits || {}) };
    this.safetyThreshold = options.safetyThreshold ?? DEFAULT_SAFETY_THRESHOLD;
    this.feeBuffer = options.feeBuffer ?? DEFAULT_FEE_BUFFER;
    this.logger = options.logger || null;
    this.metrics = options.metrics || null;
    /**
     * When true, a simulation whose resources could not be parsed is rejected
     * rather than waved through. Defaults to false so adopting this cannot
     * break execution on an SDK shape not yet handled; set it once the shape
     * is confirmed in your environment.
     */
    this.requireExtraction = options.requireExtraction ?? false;
  }

  /** Per-resource utilisation as a fraction of the protocol limit. */
  utilisation(resources) {
    const out = {};
    for (const key of Object.keys(this.limits)) {
      const limit = this.limits[key];
      out[key] = limit > 0 ? (resources[key] || 0) / limit : 0;
    }
    return out;
  }

  /**
   * Resource fee to submit with: simulated fee plus the congestion buffer.
   * Rounded up - a fractional stroop is not payable, and rounding down would
   * reintroduce the underfunding this prevents.
   */
  bufferedFee(resourceFee) {
    return Math.ceil(toNumber(resourceFee) * this.feeBuffer);
  }

  /**
   * Check a simulation against the ceilings.
   *
   * @returns {{ok: boolean, resources: object, utilisation: object,
   *            violations: Array, bufferedFee: number, threshold: number}}
   */
  evaluate(simulation, context = {}) {
    const resources = extractResources(simulation);
    const utilisation = this.utilisation(resources);

    const violations = Object.keys(this.limits)
      .filter((key) => utilisation[key] > this.safetyThreshold)
      .map((key) => ({
        resource: key,
        used: resources[key],
        limit: this.limits[key],
        unit: RESOURCE_UNITS[key],
        utilisation: utilisation[key],
        allowed: Math.floor(this.limits[key] * this.safetyThreshold),
      }));

    const unparsed = this.requireExtraction && !resources.extracted;
    const ok = violations.length === 0 && !unparsed;

    if (!ok && this.logger?.warn) {
      // Name the resource, the numbers, and the ceiling - "resource limit
      // exceeded" alone leaves an operator with nothing to act on.
      this.logger.warn('Task rejected by pre-flight resource check', {
        ...context,
        reason: unparsed ? 'resources_unparsed' : 'limit_exceeded',
        violations: violations.map((v) =>
          `${v.resource}: ${v.used} ${v.unit} is ${(v.utilisation * 100).toFixed(1)}% of the ` +
          `${v.limit} limit (ceiling ${(this.safetyThreshold * 100).toFixed(0)}% = ${v.allowed})`
        ),
      });
    }

    if (!ok) this.metrics?.increment?.('taskResourceRejectedTotal');
    else this.metrics?.increment?.('taskResourceAcceptedTotal');

    return {
      ok,
      resources,
      utilisation,
      violations,
      unparsed,
      bufferedFee: this.bufferedFee(resources.resourceFee),
      threshold: this.safetyThreshold,
    };
  }

  /**
   * `evaluate`, but throws on rejection.
   *
   * For call sites where continuing past a failed check would submit the
   * transaction anyway - a returned flag is easy to forget to read.
   */
  assertWithinLimits(simulation, context = {}) {
    const result = this.evaluate(simulation, context);
    if (result.ok) return result;

    const detail = result.unparsed
      ? 'simulation resources could not be parsed'
      : result.violations
        .map(
          (v) =>
            `${v.resource} ${v.used}${v.unit ? ` ${v.unit}` : ''} exceeds ` +
            `${(this.safetyThreshold * 100).toFixed(0)}% of ${v.limit} (max ${v.allowed})`
        )
        .join('; ');

    throw new ResourceLimitExceededError(
      `Transaction exceeds Soroban resource ceiling: ${detail}`,
      { ...context, violations: result.violations, utilisation: result.utilisation }
    );
  }
}

module.exports = {
  ResourceEstimator,
  ResourceLimitExceededError,
  extractResources,
  DEFAULT_PROTOCOL_LIMITS,
  DEFAULT_SAFETY_THRESHOLD,
  DEFAULT_FEE_BUFFER,
};

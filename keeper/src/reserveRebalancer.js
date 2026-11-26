'use strict';

/**
 * reserveRebalancer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * [BE-FINAL-44] Dynamic Gas Escrow Rebalancer Moving Liquidity Between
 * Underfunded and Idle Tasks.
 *
 * With verifiable user pre-authorization (delegation proofs), intelligently
 * redistributes surplus gas escrow balances from idle or overfunded tasks to
 * underfunded high-frequency tasks owned by the same user.
 *
 * Production hardening features:
 *  - Strict per-owner tenant isolation (never moves funds across owners)
 *  - Cryptographic delegation proof verification (HMAC-SHA256 / pluggable verifier)
 *  - Per-transfer and rolling 24h daily transfer caps
 *  - Idempotency keys with TTL to prevent duplicate on-chain transfers
 *  - Exponential backoff retries & circuit breaker for RPC resilience
 *  - Per-owner mutex serialization to prevent concurrent balance races
 *  - Structured audit trail and Prometheus-ready metrics
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const { createLogger } = require('./logger');
const { AdaptiveGasTracker } = require('./gasTracker');

const DEFAULT_IDLE_THRESHOLD_MS = 3600000; // 1 hour
const DEFAULT_MIN_TRANSFER_AMOUNT = 250;
const DEFAULT_DONOR_RETAIN_RATIO = 1.25;
const DEFAULT_HORIZON_HOURS = 12;
const DEFAULT_SAFETY_BUFFER = 1.25;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 50;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 300000; // 5 minutes
const DEFAULT_MAX_AUDIT_LOG = 500;
const DAY_MS = 86400000;

/**
 * Produce a canonical JSON string with sorted keys for deterministic signing.
 * @param {object} obj
 * @returns {string}
 */
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/**
 * Create a verifiable HMAC-SHA256 delegation proof for a user pre-authorization.
 * @param {object} delegationPayload
 * @param {string} secret
 * @returns {string} hex-encoded HMAC-SHA256 signature
 */
function createDelegationProof(delegationPayload, secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Delegation signing secret must be a non-empty string');
  }
  const payload = {
    owner: delegationPayload.owner,
    authorizedKeeper: delegationPayload.authorizedKeeper,
    maxPerRebalance: Number(delegationPayload.maxPerRebalance),
    maxDailyTransfer: Number(delegationPayload.maxDailyTransfer),
    allowedTaskIds: Array.isArray(delegationPayload.allowedTaskIds)
      ? [...delegationPayload.allowedTaskIds].sort()
      : null,
    expiresAt: Number(delegationPayload.expiresAt),
    nonce: Number(delegationPayload.nonce || 1),
  };
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalize(payload))
    .digest('hex');
}

/**
 * Constant-time hex string comparison.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

class ReserveRebalancer {
  /**
   * @param {object} [options]
   * @param {string} [options.keeperId='keeper-default']
   * @param {string} [options.delegationSecret]
   * @param {AdaptiveGasTracker} [options.gasTracker]
   * @param {Function} [options.submitRebalanceTxFn] - async (txPayload) => { txHash, status, gasUsed }
   * @param {Function} [options.verifyDelegationFn] - (delegation, context) => boolean
   * @param {number} [options.idleThresholdMs]
   * @param {number} [options.minTransferAmount]
   * @param {number} [options.donorRetainRatio]
   * @param {number} [options.horizonHours]
   * @param {number} [options.safetyBuffer]
   * @param {number} [options.maxRetries]
   * @param {number} [options.baseRetryDelayMs]
   * @param {number} [options.circuitBreakerThreshold]
   * @param {number} [options.circuitBreakerCooldownMs]
   * @param {number} [options.idempotencyTtlMs]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.logger = options.logger || createLogger('reserve-rebalancer');
    this.keeperId = options.keeperId || process.env.KEEPER_PUBLIC_KEY || 'keeper-default';
    this.delegationSecret = options.delegationSecret || process.env.DELEGATION_PROOF_SECRET || '';
    this.gasTracker = options.gasTracker || new AdaptiveGasTracker({ logger: this.logger });
    this.submitRebalanceTxFn = options.submitRebalanceTxFn || this._defaultSubmitRebalanceTx.bind(this);
    this.verifyDelegationFn = options.verifyDelegationFn || null;

    this.idleThresholdMs = Number(options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS);
    this.minTransferAmount = Math.max(1, Number(options.minTransferAmount ?? DEFAULT_MIN_TRANSFER_AMOUNT));
    this.donorRetainRatio = Math.max(1, Number(options.donorRetainRatio ?? DEFAULT_DONOR_RETAIN_RATIO));
    this.horizonHours = Math.max(0.25, Number(options.horizonHours ?? DEFAULT_HORIZON_HOURS));
    this.safetyBuffer = Math.max(1, Number(options.safetyBuffer ?? DEFAULT_SAFETY_BUFFER));

    this.maxRetries = Math.max(0, Number(options.maxRetries ?? DEFAULT_MAX_RETRIES));
    this.baseRetryDelayMs = Math.max(0, Number(options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS));
    this.circuitBreakerThreshold = Math.max(1, Number(options.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD));
    this.circuitBreakerCooldownMs = Math.max(100, Number(options.circuitBreakerCooldownMs ?? DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS));
    this.idempotencyTtlMs = Math.max(1000, Number(options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS));

    /** @type {Map<string, object>} owner -> delegation record */
    this.delegations = new Map();
    /** @type {Map<string, Array<{ amount: number, timestamp: number }>>} owner -> recent transfers */
    this.dailyTransferLedger = new Map();
    /** @type {Map<string, { result: object, expiresAt: number }>} idempotencyKey -> cached result */
    this.executedKeys = new Map();
    /** @type {Map<string, Promise>} owner -> serialization queue */
    this.ownerLocks = new Map();
    /** @type {Array<object>} */
    this.auditLog = [];

    // Circuit breaker state
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;

    // Metrics
    this.metrics = {
      totalPlansGenerated: 0,
      totalRebalancesAttempted: 0,
      successfulRebalances: 0,
      failedRebalances: 0,
      skippedDuplicates: 0,
      rejectedDelegations: 0,
      totalLiquidityMoved: 0,
      totalRebalanceGasCost: 0,
      circuitBreakerTrips: 0,
    };
  }

  /**
   * Register a user's pre-authorization delegation for automated escrow rebalancing.
   * @param {object} delegation
   * @returns {object}
   */
  registerDelegation(delegation) {
    if (!delegation || !delegation.owner) {
      throw new Error('Delegation must include an owner');
    }
    if (!delegation.signature) {
      throw new Error('Delegation must include a cryptographic signature');
    }

    const record = {
      owner: delegation.owner,
      authorizedKeeper: delegation.authorizedKeeper || this.keeperId,
      maxPerRebalance: Number(delegation.maxPerRebalance),
      maxDailyTransfer: Number(delegation.maxDailyTransfer),
      allowedTaskIds: Array.isArray(delegation.allowedTaskIds)
        ? [...delegation.allowedTaskIds].sort()
        : null,
      expiresAt: Number(delegation.expiresAt),
      nonce: Number(delegation.nonce || 1),
      signature: delegation.signature,
      revoked: false,
      registeredAt: Date.now(),
    };

    if (!Number.isFinite(record.maxPerRebalance) || record.maxPerRebalance <= 0) {
      throw new Error('Delegation maxPerRebalance must be a positive number');
    }
    if (!Number.isFinite(record.maxDailyTransfer) || record.maxDailyTransfer <= 0) {
      throw new Error('Delegation maxDailyTransfer must be a positive number');
    }
    if (!Number.isFinite(record.expiresAt)) {
      throw new Error('Delegation expiresAt must be a valid timestamp');
    }

    this.delegations.set(record.owner, record);
    return record;
  }

  /**
   * Revoke an owner's delegation immediately.
   * @param {string} owner
   * @returns {boolean}
   */
  revokeDelegation(owner) {
    const existing = this.delegations.get(owner);
    if (!existing) return false;
    existing.revoked = true;
    existing.revokedAt = Date.now();
    return true;
  }

  /**
   * Compute rolling 24h transferred amount for an owner.
   * @param {string} owner
   * @param {number} [now=Date.now()]
   * @returns {number}
   */
  getDailyTransferredAmount(owner, now = Date.now()) {
    const entries = this.dailyTransferLedger.get(owner) || [];
    const cutoff = now - DAY_MS;
    const active = entries.filter((e) => e.timestamp >= cutoff);
    if (active.length !== entries.length) {
      this.dailyTransferLedger.set(owner, active);
    }
    return active.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Verify that a user delegation proof is valid and authorizes the requested transfer.
   * @param {string} owner
   * @param {object} context
   * @param {number} context.amount
   * @param {string} context.sourceTaskId
   * @param {string} context.targetTaskId
   * @param {number} [context.now=Date.now()]
   * @returns {{ valid: boolean, reason?: string, delegation?: object, proofHash?: string }}
   */
  verifyDelegation(owner, context = {}) {
    const now = Number(context.now ?? Date.now());
    const amount = Number(context.amount ?? 0);
    const { sourceTaskId, targetTaskId } = context;

    const delegation = this.delegations.get(owner);
    if (!delegation) {
      return { valid: false, reason: 'NO_DELEGATION_FOUND' };
    }
    if (delegation.revoked) {
      return { valid: false, reason: 'DELEGATION_REVOKED' };
    }
    if (delegation.expiresAt <= now) {
      return { valid: false, reason: 'DELEGATION_EXPIRED' };
    }
    if (delegation.authorizedKeeper !== this.keeperId) {
      return { valid: false, reason: 'UNAUTHORIZED_KEEPER' };
    }
    if (amount <= 0 || amount > delegation.maxPerRebalance) {
      return { valid: false, reason: 'EXCEEDS_MAX_PER_REBALANCE' };
    }

    const dailyUsed = this.getDailyTransferredAmount(owner, now);
    if (dailyUsed + amount > delegation.maxDailyTransfer) {
      return { valid: false, reason: 'EXCEEDS_DAILY_TRANSFER_LIMIT' };
    }

    if (Array.isArray(delegation.allowedTaskIds)) {
      if (
        (sourceTaskId && !delegation.allowedTaskIds.includes(sourceTaskId)) ||
        (targetTaskId && !delegation.allowedTaskIds.includes(targetTaskId))
      ) {
        return { valid: false, reason: 'TASK_NOT_IN_ALLOWLIST' };
      }
    }

    let signatureValid = false;
    if (typeof this.verifyDelegationFn === 'function') {
      signatureValid = Boolean(this.verifyDelegationFn(delegation, context));
    } else if (this.delegationSecret) {
      const expected = createDelegationProof(delegation, this.delegationSecret);
      signatureValid = timingSafeEqualHex(delegation.signature, expected);
    }

    if (!signatureValid) {
      return { valid: false, reason: 'INVALID_DELEGATION_SIGNATURE' };
    }

    const proofHash = crypto
      .createHash('sha256')
      .update(`${delegation.signature}:${sourceTaskId || ''}:${targetTaskId || ''}:${amount}:${delegation.nonce}`)
      .digest('hex');

    return { valid: true, delegation, proofHash };
  }

  /**
   * Compute dynamic reserve thresholds for a task using explicit config or AdaptiveGasTracker.
   * @param {object} task
   * @param {number} [now=Date.now()]
   * @returns {object}
   */
  evaluateTaskLiquidity(task, now = Date.now()) {
    const balance = Math.max(0, Number(task.escrowBalance ?? task.gasBalance ?? 0));
    const isActive = task.isActive !== false;

    const tracked = this.gasTracker.estimateTaskRequiredReserve(task.taskId, {
      horizonHours: this.horizonHours,
      safetyBuffer: this.safetyBuffer,
      now,
    });

    const unitGas = Math.max(
      Number(task.avgGasPerExecution) || 0,
      tracked.unitGas || this.gasTracker.defaultBaseFee
    );
    const execPerHour = Number.isFinite(Number(task.executionsPerHour))
      ? Number(task.executionsPerHour)
      : (tracked.projectedExecutions / this.horizonHours);

    const dynamicTarget = Math.ceil(Math.max(unitGas, execPerHour * this.horizonHours * unitGas) * this.safetyBuffer);
    const targetReserve = Number(task.targetReserve) > 0 ? Number(task.targetReserve) : dynamicTarget;
    const minReserve = Number(task.minReserve) > 0
      ? Number(task.minReserve)
      : Math.ceil(targetReserve * 0.4);

    const lastExecutedAt = task.lastExecutedAt ?? null;
    const idleDurationMs = lastExecutedAt !== null
      ? Math.max(0, now - Number(lastExecutedAt))
      : tracked.idleDurationMs;
    const isIdle = !isActive || idleDurationMs >= this.idleThresholdMs || execPerHour === 0;

    const deficit = isActive && balance < minReserve
      ? Math.max(0, targetReserve - balance)
      : 0;

    const donorFloor = isIdle
      ? Math.max(minReserve, Math.ceil(unitGas * this.donorRetainRatio))
      : Math.ceil(targetReserve * this.donorRetainRatio);
    const surplus = balance > donorFloor ? Math.floor(balance - donorFloor) : 0;

    const runwayHours = execPerHour > 0 && unitGas > 0
      ? balance / (execPerHour * unitGas)
      : Infinity;

    const urgencyScore = deficit > 0
      ? Number(((deficit / Math.max(1, targetReserve)) * (1 + 1 / Math.max(0.1, runwayHours))).toFixed(4))
      : 0;

    return {
      taskId: task.taskId,
      owner: task.owner,
      isActive,
      isIdle,
      balance,
      minReserve,
      targetReserve,
      donorFloor,
      deficit,
      surplus,
      runwayHours,
      urgencyScore,
      idleDurationMs,
    };
  }

  /**
   * Generate a deterministic, tenant-isolated rebalance plan across a set of tasks.
   * @param {Array<object>} tasks
   * @param {object} [options]
   * @param {number} [options.now=Date.now()]
   * @returns {Array<object>}
   */
  planRebalances(tasks = [], options = {}) {
    const now = Number(options.now ?? Date.now());
    const byOwner = new Map();

    for (const task of tasks) {
      if (!task || !task.taskId || !task.owner) continue;
      if (!byOwner.has(task.owner)) {
        byOwner.set(task.owner, []);
      }
      byOwner.get(task.owner).push(this.evaluateTaskLiquidity(task, now));
    }

    const plans = [];

    for (const [owner, ownerTasks] of byOwner.entries()) {
      const delegation = this.delegations.get(owner);
      if (!delegation || delegation.revoked || delegation.expiresAt <= now) {
        continue;
      }

      const remainingDailyCap = Math.max(
        0,
        delegation.maxDailyTransfer - this.getDailyTransferredAmount(owner, now)
      );
      if (remainingDailyCap < this.minTransferAmount) {
        continue;
      }

      // Highest urgency underfunded tasks first
      const recipients = ownerTasks
        .filter((t) => t.deficit >= this.minTransferAmount)
        .sort((a, b) => b.urgencyScore - a.urgencyScore || a.runwayHours - b.runwayHours);

      // Prefer idle donors first, then largest surplus
      const donors = ownerTasks
        .filter((t) => t.surplus >= this.minTransferAmount)
        .map((t) => ({ ...t, availableSurplus: t.surplus }))
        .sort((a, b) => Number(b.isIdle) - Number(a.isIdle) || b.availableSurplus - a.availableSurplus);

      let ownerBudgetLeft = remainingDailyCap;

      for (const recipient of recipients) {
        let needed = recipient.deficit;
        if (ownerBudgetLeft < this.minTransferAmount) break;

        for (const donor of donors) {
          if (needed < this.minTransferAmount || ownerBudgetLeft < this.minTransferAmount) break;
          if (donor.taskId === recipient.taskId) continue;
          if (donor.availableSurplus < this.minTransferAmount) continue;

          if (Array.isArray(delegation.allowedTaskIds)) {
            if (
              !delegation.allowedTaskIds.includes(donor.taskId) ||
              !delegation.allowedTaskIds.includes(recipient.taskId)
            ) {
              continue;
            }
          }

          const amount = Math.floor(
            Math.min(needed, donor.availableSurplus, delegation.maxPerRebalance, ownerBudgetLeft)
          );
          if (amount < this.minTransferAmount) continue;

          const verification = this.verifyDelegation(owner, {
            amount,
            sourceTaskId: donor.taskId,
            targetTaskId: recipient.taskId,
            now,
          });
          if (!verification.valid) continue;

          const idempotencyKey = crypto
            .createHash('sha256')
            .update(`${owner}:${donor.taskId}:${recipient.taskId}:${amount}:${delegation.nonce}:${Math.floor(now / this.idempotencyTtlMs)}`)
            .digest('hex')
            .slice(0, 24);

          plans.push({
            idempotencyKey,
            owner,
            sourceTaskId: donor.taskId,
            targetTaskId: recipient.taskId,
            amount,
            urgencyScore: recipient.urgencyScore,
            donorWasIdle: donor.isIdle,
            delegationNonce: delegation.nonce,
            delegationSignature: delegation.signature,
            proofHash: verification.proofHash,
            plannedAt: now,
          });

          donor.availableSurplus -= amount;
          needed -= amount;
          ownerBudgetLeft -= amount;
        }
      }
    }

    this.metrics.totalPlansGenerated += plans.length;
    return plans;
  }

  /**
   * Check whether the circuit breaker is currently open.
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  isCircuitOpen(now = Date.now()) {
    if (this.circuitOpenedAt === null) return false;
    if (now - this.circuitOpenedAt >= this.circuitBreakerCooldownMs) {
      // Transition to half-open
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  /**
   * Execute a single planned rebalance on-chain with proof verification,
   * idempotency, per-owner serialization, retries, and circuit breaking.
   * @param {object} planItem
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async executeRebalance(planItem, options = {}) {
    const now = Number(options.now ?? Date.now());
    const { owner, sourceTaskId, targetTaskId, amount, idempotencyKey } = planItem;

    // Serialize per owner to avoid concurrent balance/daily-cap races
    const prevLock = this.ownerLocks.get(owner) || Promise.resolve();
    let releaseLock;
    const currentLock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const chained = prevLock.then(() => currentLock);
    this.ownerLocks.set(owner, chained);

    await prevLock;
    try {
      this._pruneIdempotencyCache(now);

      if (idempotencyKey && this.executedKeys.has(idempotencyKey)) {
        this.metrics.skippedDuplicates += 1;
        return {
          ...this.executedKeys.get(idempotencyKey).result,
          deduplicated: true,
        };
      }

      if (this.isCircuitOpen(now)) {
        return {
          status: 'CIRCUIT_OPEN',
          owner,
          sourceTaskId,
          targetTaskId,
          amount,
          reason: 'CIRCUIT_BREAKER_OPEN',
        };
      }

      const verification = this.verifyDelegation(owner, {
        amount,
        sourceTaskId,
        targetTaskId,
        now,
      });

      if (!verification.valid) {
        this.metrics.rejectedDelegations += 1;
        this._recordAudit({
          type: 'REBALANCE_REJECTED',
          owner,
          sourceTaskId,
          targetTaskId,
          amount,
          reason: verification.reason,
          timestamp: now,
        });
        return {
          status: 'REJECTED',
          owner,
          sourceTaskId,
          targetTaskId,
          amount,
          reason: verification.reason,
        };
      }

      this.metrics.totalRebalancesAttempted += 1;
      const forecast = this.gasTracker.forecastInclusionFee({ horizonLedgers: 3 });

      const txPayload = {
        idempotencyKey,
        owner,
        sourceTaskId,
        targetTaskId,
        amount,
        recommendedFee: forecast.recommendedFee,
        delegationProof: {
          owner,
          authorizedKeeper: verification.delegation.authorizedKeeper,
          nonce: verification.delegation.nonce,
          expiresAt: verification.delegation.expiresAt,
          signature: verification.delegation.signature,
          proofHash: verification.proofHash,
        },
      };

      let lastError = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const txResult = await this.submitRebalanceTxFn(txPayload);
          this.consecutiveFailures = 0;
          this.circuitOpenedAt = null;

          if (!this.dailyTransferLedger.has(owner)) {
            this.dailyTransferLedger.set(owner, []);
          }
          this.dailyTransferLedger.get(owner).push({ amount, timestamp: now });

          this.metrics.successfulRebalances += 1;
          this.metrics.totalLiquidityMoved += amount;
          this.metrics.totalRebalanceGasCost += Number(txResult?.gasUsed ?? forecast.recommendedFee);

          const result = {
            status: 'CONFIRMED',
            owner,
            sourceTaskId,
            targetTaskId,
            amount,
            txHash: txResult?.txHash || `tx_${idempotencyKey}`,
            proofHash: verification.proofHash,
            gasUsed: Number(txResult?.gasUsed ?? forecast.recommendedFee),
            attempts: attempt + 1,
            timestamp: now,
          };

          if (idempotencyKey) {
            this.executedKeys.set(idempotencyKey, {
              result,
              expiresAt: now + this.idempotencyTtlMs,
            });
          }

          this._recordAudit({ type: 'REBALANCE_CONFIRMED', ...result });
          return result;
        } catch (err) {
          lastError = err;
          if (attempt < this.maxRetries && this.baseRetryDelayMs > 0) {
            const delay = this.baseRetryDelayMs * (2 ** attempt);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      this.consecutiveFailures += 1;
      this.metrics.failedRebalances += 1;
      if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
        this.circuitOpenedAt = now;
        this.metrics.circuitBreakerTrips += 1;
        this.logger.error('ReserveRebalancer circuit breaker opened due to consecutive RPC failures');
      }

      const failureResult = {
        status: 'FAILED',
        owner,
        sourceTaskId,
        targetTaskId,
        amount,
        error: lastError ? lastError.message : 'UNKNOWN_ERROR',
        attempts: this.maxRetries + 1,
        timestamp: now,
      };
      this._recordAudit({ type: 'REBALANCE_FAILED', ...failureResult });
      return failureResult;
    } finally {
      releaseLock();
      if (this.ownerLocks.get(owner) === chained) {
        this.ownerLocks.delete(owner);
      }
    }
  }

  /**
   * Plan and execute all eligible rebalances for a batch of tasks.
   * @param {Array<object>} tasks
   * @param {object} [options]
   * @returns {Promise<{ plans: Array<object>, results: Array<object>, summary: object }>}
   */
  async rebalanceAll(tasks = [], options = {}) {
    const plans = this.planRebalances(tasks, options);
    const results = [];

    for (const plan of plans) {
      const res = await this.executeRebalance(plan, options);
      results.push(res);
    }

    const confirmed = results.filter((r) => r.status === 'CONFIRMED');
    const failed = results.filter((r) => r.status === 'FAILED');
    const totalMoved = confirmed.reduce((sum, r) => sum + r.amount, 0);

    return {
      plans,
      results,
      summary: {
        plannedCount: plans.length,
        confirmedCount: confirmed.length,
        failedCount: failed.length,
        totalMoved,
      },
    };
  }

  /**
   * Default mock/local on-chain transaction submitter when no RPC contract client is injected.
   * @param {object} txPayload
   * @returns {Promise<{ txHash: string, status: string, gasUsed: number }>}
   */
  async _defaultSubmitRebalanceTx(txPayload) {
    const txHash = crypto
      .createHash('sha256')
      .update(`${txPayload.idempotencyKey}:${txPayload.delegationProof.proofHash}:${Date.now()}`)
      .digest('hex');
    return {
      txHash,
      status: 'CONFIRMED',
      gasUsed: txPayload.recommendedFee || 100,
    };
  }

  _pruneIdempotencyCache(now) {
    for (const [key, entry] of this.executedKeys.entries()) {
      if (entry.expiresAt <= now) {
        this.executedKeys.delete(key);
      }
    }
  }

  _recordAudit(entry) {
    this.auditLog.push(entry);
    if (this.auditLog.length > DEFAULT_MAX_AUDIT_LOG) {
      this.auditLog.shift();
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      circuitState: this.isCircuitOpen() ? 'OPEN' : 'CLOSED',
      activeDelegations: [...this.delegations.values()].filter((d) => !d.revoked).length,
    };
  }

  getAuditLog(limit = 50) {
    return this.auditLog.slice(-Math.max(1, limit));
  }
}

let defaultReserveRebalancer = null;

function getReserveRebalancer(options) {
  if (!defaultReserveRebalancer || options) {
    defaultReserveRebalancer = new ReserveRebalancer(options);
  }
  return defaultReserveRebalancer;
}

module.exports = {
  ReserveRebalancer,
  getReserveRebalancer,
  createDelegationProof,
};

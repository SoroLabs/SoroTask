'use strict';

/**
 * priorityScheduler.js — multi-tier priority queue with dynamic aging and
 * starvation defence (Issue #1057).
 *
 * # The starvation bug
 *
 * The queue sorted a batch by static priority, highest first, and rebuilt that
 * batch every polling cycle. Nothing in that ordering referred to how long a
 * task had already been waiting, so a task that lost the comparison once lost
 * it again on the next cycle, and the next. Under sustained high-bounty task
 * creation a low-bounty or maintenance task is never the maximum, and so is
 * never executed — not delayed, *starved*. Its SLA is missed silently, because
 * from the queue's point of view nothing went wrong.
 *
 * # The fix
 *
 * Priority stops being a property of the task and becomes a function of the
 * task *and how long it has waited*:
 *
 *     effective_priority = base_bounty + (wait_time_seconds * aging_factor)
 *
 * Aging is what breaks the tie eventually: given enough wait, any task
 * out-scores a newer one, so every task reaches the front. `agingFactor` sets
 * how fast — it is expressed in bounty-units per second, so it can be reasoned
 * about directly ("a task gains the equivalent of 1 bounty unit per second").
 *
 * Aging alone still only bounds wait *statistically*, and the acceptance
 * criterion is zero starvation. So tiering sits above the score: once a task
 * passes its SLA deadline — or has simply waited longer than `maxWaitMs` — it
 * is promoted into CRITICAL_SLA, which is drained before anything else
 * regardless of bounty. That converts "eventually" into a hard bound.
 */

/**
 * Execution tiers, drained strictly in order. A Standard task never runs while
 * a CriticalSla task is waiting.
 */
const Tier = Object.freeze({
  CRITICAL_SLA: 0,
  HIGH_BOUNTY: 1,
  STANDARD: 2,
});

const TIER_NAMES = Object.freeze({
  [Tier.CRITICAL_SLA]: 'critical_sla',
  [Tier.HIGH_BOUNTY]: 'high_bounty',
  [Tier.STANDARD]: 'standard',
});

const DEFAULTS = Object.freeze({
  /** Bounty units gained per second of waiting. */
  agingFactor: 1,
  /** At or above this base bounty a task starts in HIGH_BOUNTY. */
  highBountyThreshold: 100,
  /**
   * Hard ceiling on queue wait. Anything older is promoted to CRITICAL_SLA
   * whatever its bounty — this is the starvation guarantee, and it is why the
   * scheduler can promise a bound rather than a tendency.
   */
  maxWaitMs: 5 * 60 * 1000,
  /**
   * Promote to CRITICAL_SLA this long before the SLA deadline, so the task is
   * scheduled with time left to actually execute rather than exactly as it
   * expires.
   */
  slaLeadMs: 30 * 1000,
});

function toNumber(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Base bounty for a task, from whichever field carries it.
 *
 * Bounties arrive as strings from the chain often enough that coercing here
 * is worth it — a string bounty silently comparing as NaN is the kind of bug
 * that reads as "the scheduler ignored my task".
 */
function baseBountyOf(task) {
  return toNumber(task?.bounty ?? task?.bountyAmount ?? task?.priority, 0);
}

class PriorityScheduler {
  constructor(options = {}) {
    this.agingFactor = toNumber(options.agingFactor, DEFAULTS.agingFactor);
    this.highBountyThreshold = toNumber(options.highBountyThreshold, DEFAULTS.highBountyThreshold);
    this.maxWaitMs = toNumber(options.maxWaitMs, DEFAULTS.maxWaitMs);
    this.slaLeadMs = toNumber(options.slaLeadMs, DEFAULTS.slaLeadMs);
    this.now = options.now || (() => Date.now());
    this.metrics = options.metrics || null;
    this.logger = options.logger || null;
  }

  /** Milliseconds a task has been queued. Never negative. */
  waitMs(task, now = this.now()) {
    const queuedAt = toNumber(task?.queuedAtMs ?? task?.enqueuedAt ?? task?.queuedAt, now);
    return Math.max(0, now - queuedAt);
  }

  /**
   * `base_bounty + wait_seconds * aging_factor`.
   *
   * Deliberately not clamped: an unbounded score is what guarantees a waiting
   * task eventually exceeds any fixed bounty. The tier system bounds latency;
   * the score only has to bound *order*.
   */
  effectivePriority(task, now = this.now()) {
    return baseBountyOf(task) + (this.waitMs(task, now) / 1000) * this.agingFactor;
  }

  /** True once the task is within `slaLeadMs` of its deadline, or past it. */
  isSlaUrgent(task, now = this.now()) {
    const deadline = toNumber(task?.slaDeadlineMs ?? task?.slaDeadline, NaN);
    if (!Number.isFinite(deadline)) return false;
    return now >= deadline - this.slaLeadMs;
  }

  /** True once the task has waited longer than the hard ceiling. */
  isStarved(task, now = this.now()) {
    return this.waitMs(task, now) >= this.maxWaitMs;
  }

  /**
   * Tier for a task right now.
   *
   * Order of checks matters: SLA urgency and starvation both override bounty,
   * because both are correctness conditions while bounty is only a preference.
   */
  tierOf(task, now = this.now()) {
    if (this.isSlaUrgent(task, now) || this.isStarved(task, now)) {
      return Tier.CRITICAL_SLA;
    }
    if (baseBountyOf(task) >= this.highBountyThreshold) {
      return Tier.HIGH_BOUNTY;
    }
    return Tier.STANDARD;
  }

  /**
   * Annotate a task with its current tier and score, without mutating it.
   *
   * Returning a wrapper rather than mutating keeps the caller's task objects
   * clean — they are published to Kafka and persisted elsewhere, and scheduling
   * metadata has no business travelling with them.
   */
  annotate(task, now = this.now()) {
    const tier = this.tierOf(task, now);
    return {
      task,
      tier,
      tierName: TIER_NAMES[tier],
      effectivePriority: this.effectivePriority(task, now),
      waitMs: this.waitMs(task, now),
      promoted: tier === Tier.CRITICAL_SLA && baseBountyOf(task) < this.highBountyThreshold,
    };
  }

  /**
   * Order tasks for execution: tier ascending, then effective priority
   * descending, then FIFO within a tie.
   *
   * The FIFO tiebreak matters more than it looks — without it, two tasks with
   * identical scores can swap places between cycles, which makes queue
   * behaviour non-reproducible and starvation bugs impossible to reason about.
   */
  order(tasks, now = this.now()) {
    return (tasks || [])
      .map((task, index) => ({ ...this.annotate(task, now), index }))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (a.effectivePriority !== b.effectivePriority) {
          return b.effectivePriority - a.effectivePriority;
        }
        if (a.waitMs !== b.waitMs) return b.waitMs - a.waitMs; // older first
        return a.index - b.index; // stable
      })
      .map((entry) => entry.task);
  }

  /**
   * Tasks that have crossed into CRITICAL_SLA since being queued.
   *
   * Intended for a periodic sweep so promotions are observable — a task that
   * silently jumps the queue is indistinguishable from a scheduling bug when
   * someone is reading logs after an incident.
   */
  promoteAged(tasks, now = this.now()) {
    const promoted = (tasks || [])
      .map((task) => this.annotate(task, now))
      .filter((entry) => entry.promoted);

    if (promoted.length > 0) {
      if (this.metrics?.increment) {
        this.metrics.increment('queueTasksPromotedTotal', promoted.length);
      }
      if (this.logger?.info) {
        this.logger.info('Promoted aged tasks to critical SLA tier', {
          count: promoted.length,
          maxWaitMs: this.maxWaitMs,
          taskIds: promoted.map((e) => e.task?.taskId).filter((id) => id !== undefined),
        });
      }
    }

    return promoted;
  }

  /** Per-tier depth, for dashboards and starvation alerting. */
  tierBreakdown(tasks, now = this.now()) {
    const breakdown = { critical_sla: 0, high_bounty: 0, standard: 0 };
    for (const task of tasks || []) {
      breakdown[TIER_NAMES[this.tierOf(task, now)]] += 1;
    }
    return breakdown;
  }

  /**
   * Longest current wait, for asserting the SLA bound in tests and monitoring.
   */
  maxObservedWaitMs(tasks, now = this.now()) {
    return (tasks || []).reduce((max, task) => Math.max(max, this.waitMs(task, now)), 0);
  }
}

module.exports = {
  PriorityScheduler,
  Tier,
  TIER_NAMES,
  DEFAULTS,
  baseBountyOf,
};

'use strict';

/**
 * priorityScheduler.test.js - multi-tier priority queue with aging (Issue #1057).
 *
 * Time is injected everywhere so the aging behaviour can be asserted exactly
 * rather than slept through.
 */

const { PriorityScheduler, Tier } = require('../src/priorityScheduler');

/** Scheduler with a caller-controlled clock. */
function makeScheduler(nowRef, overrides = {}) {
  return new PriorityScheduler({
    agingFactor: 1,
    highBountyThreshold: 100,
    maxWaitMs: 60000,
    slaLeadMs: 5000,
    now: () => nowRef.value,
    ...overrides,
  });
}

describe('PriorityScheduler - tiering', () => {
  const now = { value: 0 };
  const scheduler = makeScheduler(now);

  beforeEach(() => {
    now.value = 0;
  });

  it('places a high bounty task in the high-bounty tier', () => {
    expect(scheduler.tierOf({ bounty: 500, queuedAtMs: 0 })).toBe(Tier.HIGH_BOUNTY);
  });

  it('places a low bounty task in the standard tier', () => {
    expect(scheduler.tierOf({ bounty: 10, queuedAtMs: 0 })).toBe(Tier.STANDARD);
  });

  it('promotes a task approaching its SLA deadline', () => {
    // Deadline is 1s away and slaLeadMs is 5s, so it is already urgent.
    expect(scheduler.tierOf({ bounty: 10, queuedAtMs: 0, slaDeadlineMs: 1000 }))
      .toBe(Tier.CRITICAL_SLA);
  });

  it('promotes a task that has waited past the hard ceiling', () => {
    now.value = 60000;
    // Bounty of 1 would otherwise be the lowest-priority thing in the queue.
    expect(scheduler.tierOf({ bounty: 1, queuedAtMs: 0 })).toBe(Tier.CRITICAL_SLA);
  });
});

describe('PriorityScheduler - dynamic aging', () => {
  const now = { value: 0 };
  const scheduler = makeScheduler(now);

  it('applies base_bounty + wait_seconds * aging_factor', () => {
    now.value = 200000; // 200s
    expect(scheduler.effectivePriority({ bounty: 10, queuedAtMs: 0 })).toBe(210);
  });

  it('lets an aged task overtake a richer newcomer', () => {
    now.value = 200000;
    const aged = { taskId: 'aged', bounty: 10, queuedAtMs: 0 };
    const fresh = { taskId: 'fresh', bounty: 200, queuedAtMs: 200000 };

    // 10 + 200 = 210 beats a fresh 200. This is the whole point: without
    // aging, `fresh` wins now and every subsequent cycle.
    expect(scheduler.order([fresh, aged])[0].taskId).toBe('aged');
  });

  it('coerces a stringified bounty rather than scoring it as NaN', () => {
    now.value = 0;
    expect(scheduler.effectivePriority({ bounty: '50', queuedAtMs: 0 })).toBe(50);
  });

  it('never reports a negative wait for a future timestamp', () => {
    now.value = 0;
    expect(scheduler.waitMs({ queuedAtMs: 5000 })).toBe(0);
  });
});

describe('PriorityScheduler - ordering', () => {
  const now = { value: 0 };
  const scheduler = makeScheduler(now);

  it('drains the critical tier ahead of any bounty', () => {
    now.value = 200000;
    const rich = { taskId: 'rich', bounty: 1e9, queuedAtMs: 200000 };
    const starved = { taskId: 'starved', bounty: 0, queuedAtMs: 0 };

    expect(scheduler.order([rich, starved])[0].taskId).toBe('starved');
  });

  it('is stable for exact ties, so ordering is reproducible', () => {
    now.value = 1000;
    const a = { taskId: 'a', bounty: 5, queuedAtMs: 0 };
    const b = { taskId: 'b', bounty: 5, queuedAtMs: 0 };

    expect(scheduler.order([a, b]).map((t) => t.taskId)).toEqual(['a', 'b']);
    expect(scheduler.order([b, a]).map((t) => t.taskId)).toEqual(['b', 'a']);
  });

  it('does not mutate the tasks it orders', () => {
    now.value = 1000;
    const task = { taskId: 'x', bounty: 5, queuedAtMs: 0 };
    scheduler.order([task]);
    // Scheduling metadata must not travel with tasks that get published and
    // persisted elsewhere.
    expect(Object.keys(task)).toEqual(['taskId', 'bounty', 'queuedAtMs']);
  });

  it('handles an empty or missing queue', () => {
    expect(scheduler.order([])).toEqual([]);
    expect(scheduler.order(undefined)).toEqual([]);
  });
});

describe('PriorityScheduler - starvation defence', () => {
  it('executes a low-bounty task within the SLA ceiling under constant high-bounty load', () => {
    // The reported failure, reproduced: a rich rival arrives every cycle. On
    // the old static-priority sort the maintenance task never reaches the head.
    const now = { value: 0 };
    const scheduler = makeScheduler(now);

    let queue = [{ taskId: 'maintenance', bounty: 1, queuedAtMs: 0 }];
    let executedAt = null;

    for (let cycle = 1; cycle <= 200 && executedAt === null; cycle += 1) {
      now.value = cycle * 1000;
      queue.push({ taskId: `rich-${cycle}`, bounty: 5000, queuedAtMs: now.value });

      const head = scheduler.order(queue)[0];
      if (head.taskId === 'maintenance') {
        executedAt = now.value;
      } else {
        queue = queue.filter((t) => t.taskId !== head.taskId);
      }
    }

    expect(executedAt).not.toBeNull();
    // Bounded by maxWaitMs, not merely "eventually".
    expect(executedAt).toBeLessThanOrEqual(61000);
  });

  it('reports promotions so a queue jump is visible after an incident', () => {
    const now = { value: 60000 };
    const metrics = { increment: jest.fn() };
    const logger = { info: jest.fn() };
    const scheduler = makeScheduler(now, { metrics, logger });

    const promoted = scheduler.promoteAged([{ taskId: 'z', bounty: 1, queuedAtMs: 0 }]);

    expect(promoted).toHaveLength(1);
    expect(promoted[0].tierName).toBe('critical_sla');
    expect(metrics.increment).toHaveBeenCalledWith('queueTasksPromotedTotal', 1);
    expect(logger.info).toHaveBeenCalled();
  });

  it('does not report a high-bounty task reaching critical as a promotion', () => {
    // It was never at risk of starving, so counting it would inflate the
    // metric that is supposed to signal starvation pressure.
    const now = { value: 60000 };
    const scheduler = makeScheduler(now);
    expect(scheduler.promoteAged([{ taskId: 'rich', bounty: 5000, queuedAtMs: 0 }])).toHaveLength(0);
  });
});

describe('PriorityScheduler - observability', () => {
  it('reports per-tier depth', () => {
    const now = { value: 60000 };
    const scheduler = makeScheduler(now);

    const breakdown = scheduler.tierBreakdown([
      { taskId: 'a', bounty: 1, queuedAtMs: 0 }, // starved -> critical
      { taskId: 'b', bounty: 500, queuedAtMs: 60000 }, // high bounty
      { taskId: 'c', bounty: 1, queuedAtMs: 60000 }, // standard
    ]);

    expect(breakdown).toEqual({ critical_sla: 1, high_bounty: 1, standard: 1 });
  });

  it('reports the longest current wait', () => {
    const now = { value: 10000 };
    const scheduler = makeScheduler(now);
    expect(
      scheduler.maxObservedWaitMs([{ queuedAtMs: 0 }, { queuedAtMs: 7000 }])
    ).toBe(10000);
  });
});

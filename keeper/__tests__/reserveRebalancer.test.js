'use strict';

const { AdaptiveGasTracker } = require('../src/gasTracker');
const {
  ReserveRebalancer,
  createDelegationProof,
} = require('../src/reserveRebalancer');

const SECRET = 'test-delegation-hmac-secret-be-final-44';
const KEEPER_ID = 'GKEEPER_TEST_PUBLIC_KEY';

function makeDelegation(overrides = {}) {
  const payload = {
    owner: 'GUSER_ALICE',
    authorizedKeeper: KEEPER_ID,
    maxPerRebalance: 5000,
    maxDailyTransfer: 15000,
    allowedTaskIds: null,
    expiresAt: Date.now() + 3600000,
    nonce: 1,
    ...overrides,
  };
  return {
    ...payload,
    signature: overrides.signature || createDelegationProof(payload, SECRET),
  };
}

describe('[BE-FINAL-44] Dynamic Gas Escrow Rebalancer', () => {
  describe('Unit: AdaptiveGasTracker per-task burn-rate & reserve estimation', () => {
    test('tracks per-task gas usage and estimates burn rate and required reserve', () => {
      const tracker = new AdaptiveGasTracker({ defaultBaseFee: 100 });
      const now = 1_700_000_000_000;

      tracker.recordLedgerSample({ ledgerSequence: 1, baseFee: 120, fillRatio: 0.5, mempoolDepth: 80 });
      for (let i = 0; i < 6; i++) {
        tracker.recordTaskGasUsage('task-hot', 300, now - (6 - i) * 600_000);
      }

      const burn = tracker.estimateTaskBurnRate('task-hot', { windowMs: 3_600_000, now });
      expect(burn.executionsInWindow).toBe(6);
      expect(burn.avgGasPerExecution).toBe(300);
      expect(burn.executionsPerHour).toBe(6);
      expect(burn.burnRatePerHour).toBe(1800);

      const reserve = tracker.estimateTaskRequiredReserve('task-hot', {
        horizonHours: 10,
        safetyBuffer: 1.25,
        now,
      });
      expect(reserve.recommendedReserve).toBeGreaterThanOrEqual(22500);
      expect(reserve.burnRatePerHour).toBe(1800);
    });
  });

  describe('Unit: Delegation proof verification & tenant isolation', () => {
    test('verifies valid cryptographic delegation proofs and rejects tampered/expired/revoked proofs', () => {
      const rebalancer = new ReserveRebalancer({
        keeperId: KEEPER_ID,
        delegationSecret: SECRET,
      });
      const now = Date.now();
      const validDel = makeDelegation({ expiresAt: now + 60_000 });
      rebalancer.registerDelegation(validDel);

      const ok = rebalancer.verifyDelegation('GUSER_ALICE', {
        amount: 1000,
        sourceTaskId: 'idle-1',
        targetTaskId: 'hot-1',
        now,
      });
      expect(ok.valid).toBe(true);
      expect(ok.proofHash).toMatch(/^[a-f0-9]{64}$/);

      // Rejects amount exceeding maxPerRebalance
      const overCap = rebalancer.verifyDelegation('GUSER_ALICE', {
        amount: 6000,
        sourceTaskId: 'idle-1',
        targetTaskId: 'hot-1',
        now,
      });
      expect(overCap.valid).toBe(false);
      expect(overCap.reason).toBe('EXCEEDS_MAX_PER_REBALANCE');

      // Rejects expired
      const expired = rebalancer.verifyDelegation('GUSER_ALICE', {
        amount: 1000,
        sourceTaskId: 'idle-1',
        targetTaskId: 'hot-1',
        now: now + 120_000,
      });
      expect(expired.valid).toBe(false);
      expect(expired.reason).toBe('DELEGATION_EXPIRED');

      // Rejects tampered signature
      rebalancer.registerDelegation(makeDelegation({
        owner: 'GUSER_BOB',
        signature: '0'.repeat(64),
        expiresAt: now + 60_000,
      }));
      const tampered = rebalancer.verifyDelegation('GUSER_BOB', {
        amount: 1000,
        sourceTaskId: 'idle-b',
        targetTaskId: 'hot-b',
        now,
      });
      expect(tampered.valid).toBe(false);
      expect(tampered.reason).toBe('INVALID_DELEGATION_SIGNATURE');

      // Rejects after revocation
      rebalancer.revokeDelegation('GUSER_ALICE');
      const revoked = rebalancer.verifyDelegation('GUSER_ALICE', {
        amount: 1000,
        sourceTaskId: 'idle-1',
        targetTaskId: 'hot-1',
        now,
      });
      expect(revoked.valid).toBe(false);
      expect(revoked.reason).toBe('DELEGATION_REVOKED');
    });

    test('enforces strict tenant isolation and never moves funds across different owners', () => {
      const rebalancer = new ReserveRebalancer({
        keeperId: KEEPER_ID,
        delegationSecret: SECRET,
      });
      const now = Date.now();
      rebalancer.registerDelegation(makeDelegation({ owner: 'GUSER_ALICE', expiresAt: now + 60_000 }));
      rebalancer.registerDelegation(makeDelegation({ owner: 'GUSER_BOB', expiresAt: now + 60_000 }));

      const tasks = [
        // Alice has an underfunded task but no surplus donor
        {
          taskId: 'alice-hot',
          owner: 'GUSER_ALICE',
          escrowBalance: 100,
          minReserve: 1000,
          targetReserve: 3000,
          executionsPerHour: 10,
          avgGasPerExecution: 200,
          lastExecutedAt: now - 60_000,
          isActive: true,
        },
        // Bob has a huge idle surplus task
        {
          taskId: 'bob-idle',
          owner: 'GUSER_BOB',
          escrowBalance: 20000,
          minReserve: 500,
          targetReserve: 1000,
          executionsPerHour: 0,
          avgGasPerExecution: 100,
          lastExecutedAt: now - 7_200_000,
          isActive: true,
        },
      ];

      const plans = rebalancer.planRebalances(tasks, { now });
      expect(plans).toHaveLength(0);
    });
  });

  describe('Integration: On-chain execution, idempotency, retries & circuit breaker', () => {
    test('executes on-chain rebalance with verifiable delegation proof and deduplicates retries', async () => {
      const submittedTxs = [];
      const rebalancer = new ReserveRebalancer({
        keeperId: KEEPER_ID,
        delegationSecret: SECRET,
        submitRebalanceTxFn: async (txPayload) => {
          submittedTxs.push(txPayload);
          return { txHash: `tx_${submittedTxs.length}`, status: 'CONFIRMED', gasUsed: 150 };
        },
      });
      const now = Date.now();
      rebalancer.registerDelegation(makeDelegation({ owner: 'GUSER_ALICE', expiresAt: now + 60_000 }));

      const tasks = [
        {
          taskId: 'alice-hot',
          owner: 'GUSER_ALICE',
          escrowBalance: 200,
          minReserve: 1000,
          targetReserve: 3200,
          executionsPerHour: 12,
          avgGasPerExecution: 200,
          lastExecutedAt: now - 30_000,
          isActive: true,
        },
        {
          taskId: 'alice-idle',
          owner: 'GUSER_ALICE',
          escrowBalance: 8000,
          minReserve: 500,
          targetReserve: 1000,
          executionsPerHour: 0,
          avgGasPerExecution: 100,
          lastExecutedAt: now - 10_000_000,
          isActive: true,
        },
      ];

      const { plans, results, summary } = await rebalancer.rebalanceAll(tasks, { now });
      expect(plans).toHaveLength(1);
      expect(summary.confirmedCount).toBe(1);
      expect(summary.totalMoved).toBe(3000);
      expect(submittedTxs).toHaveLength(1);
      expect(submittedTxs[0].delegationProof.owner).toBe('GUSER_ALICE');
      expect(submittedTxs[0].delegationProof.proofHash).toMatch(/^[a-f0-9]{64}$/);

      // Re-executing same planItem should be deduplicated by idempotency guard
      const dupResult = await rebalancer.executeRebalance(plans[0], { now });
      expect(dupResult.deduplicated).toBe(true);
      expect(submittedTxs).toHaveLength(1);
      expect(rebalancer.getMetrics().skippedDuplicates).toBe(1);
    });

    test('retries transient RPC failures and trips circuit breaker after threshold', async () => {
      let calls = 0;
      const rebalancer = new ReserveRebalancer({
        keeperId: KEEPER_ID,
        delegationSecret: SECRET,
        maxRetries: 1,
        baseRetryDelayMs: 1,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 5000,
        submitRebalanceTxFn: async () => {
          calls += 1;
          throw new Error('RPC_TIMEOUT');
        },
      });
      const now = Date.now();
      rebalancer.registerDelegation(makeDelegation({ owner: 'GUSER_ALICE', expiresAt: now + 60_000 }));

      const basePlan = {
        owner: 'GUSER_ALICE',
        sourceTaskId: 'idle-1',
        targetTaskId: 'hot-1',
        amount: 500,
      };

      const r1 = await rebalancer.executeRebalance({ ...basePlan, idempotencyKey: 'k1' }, { now });
      expect(r1.status).toBe('FAILED');
      expect(r1.attempts).toBe(2);

      const r2 = await rebalancer.executeRebalance({ ...basePlan, idempotencyKey: 'k2' }, { now });
      expect(r2.status).toBe('FAILED');
      expect(rebalancer.isCircuitOpen(now)).toBe(true);

      const r3 = await rebalancer.executeRebalance({ ...basePlan, idempotencyKey: 'k3' }, { now });
      expect(r3.status).toBe('CIRCUIT_OPEN');
      expect(calls).toBe(4); // 2 attempts * 2 failed calls; 3rd short-circuited
    });
  });

  describe('Stress & Acceptance Criteria: >= 75% halt reduction & high-volume scalability', () => {
    test('reduces task halts due to gas depletion by >= 75% and optimizes gas utilization', async () => {
      const now = Date.now();
      const STEPS = 40;
      const GAS_PER_EXEC = 250;

      // Helper to run workload with or without rebalancing
      async function runWorkload(enableRebalancing) {
        const rebalancer = new ReserveRebalancer({
          keeperId: KEEPER_ID,
          delegationSecret: SECRET,
          minTransferAmount: 250,
        });
        rebalancer.registerDelegation(makeDelegation({
          owner: 'GUSER_POWER',
          maxPerRebalance: 5000,
          maxDailyTransfer: 50000,
          expiresAt: now + 86_400_000,
        }));

        const tasks = [
          // 2 high-frequency active tasks starting with low balance
          {
            taskId: 'hot-1',
            owner: 'GUSER_POWER',
            escrowBalance: 750,
            minReserve: 1000,
            targetReserve: 2500,
            executionsPerHour: 10,
            avgGasPerExecution: GAS_PER_EXEC,
            lastExecutedAt: now,
            isActive: true,
          },
          {
            taskId: 'hot-2',
            owner: 'GUSER_POWER',
            escrowBalance: 500,
            minReserve: 1000,
            targetReserve: 2500,
            executionsPerHour: 10,
            avgGasPerExecution: GAS_PER_EXEC,
            lastExecutedAt: now,
            isActive: true,
          },
          // 2 idle tasks sitting on surplus escrow funds
          {
            taskId: 'idle-1',
            owner: 'GUSER_POWER',
            escrowBalance: 15000,
            minReserve: 500,
            targetReserve: 1000,
            executionsPerHour: 0,
            avgGasPerExecution: 100,
            lastExecutedAt: now - 10_000_000,
            isActive: true,
          },
          {
            taskId: 'idle-2',
            owner: 'GUSER_POWER',
            escrowBalance: 15000,
            minReserve: 500,
            targetReserve: 1000,
            executionsPerHour: 0,
            avgGasPerExecution: 100,
            lastExecutedAt: now - 10_000_000,
            isActive: true,
          },
        ];

        const byId = new Map(tasks.map((t) => [t.taskId, t]));
        let halts = 0;
        let totalExecutedGas = 0;
        const initialTotalEscrow = tasks.reduce((s, t) => s + t.escrowBalance, 0);

        for (let step = 0; step < STEPS; step++) {
          const stepNow = now + step * 60_000;
          if (enableRebalancing) {
            const { results } = await rebalancer.rebalanceAll(tasks, { now: stepNow });
            for (const r of results) {
              if (r.status === 'CONFIRMED') {
                byId.get(r.sourceTaskId).escrowBalance -= r.amount;
                byId.get(r.targetTaskId).escrowBalance += r.amount;
              }
            }
          }

          for (const hotId of ['hot-1', 'hot-2']) {
            const t = byId.get(hotId);
            if (t.escrowBalance >= GAS_PER_EXEC) {
              t.escrowBalance -= GAS_PER_EXEC;
              t.lastExecutedAt = stepNow;
              totalExecutedGas += GAS_PER_EXEC;
            } else {
              halts += 1;
            }
          }
        }

        return {
          halts,
          utilizationRatio: totalExecutedGas / initialTotalEscrow,
        };
      }

      const baseline = await runWorkload(false);
      const rebalanced = await runWorkload(true);

      const haltReductionPct = ((baseline.halts - rebalanced.halts) / Math.max(1, baseline.halts)) * 100;
      expect(baseline.halts).toBeGreaterThan(50);
      expect(haltReductionPct).toBeGreaterThanOrEqual(75);
      expect(rebalanced.utilizationRatio).toBeGreaterThan(baseline.utilizationRatio * 3);
    });

    test('handles 200 tasks across 20 owners under high-volume rebalancing stress', async () => {
      const rebalancer = new ReserveRebalancer({
        keeperId: KEEPER_ID,
        delegationSecret: SECRET,
      });
      const now = Date.now();
      const tasks = [];

      for (let u = 0; u < 20; u++) {
        const owner = `GUSER_${u}`;
        rebalancer.registerDelegation(makeDelegation({
          owner,
          maxPerRebalance: 5000,
          maxDailyTransfer: 50000,
          expiresAt: now + 3_600_000,
        }));

        for (let t = 0; t < 10; t++) {
          const isHot = t < 5;
          tasks.push({
            taskId: `${owner}-task-${t}`,
            owner,
            escrowBalance: isHot ? 100 : 8000,
            minReserve: isHot ? 1000 : 500,
            targetReserve: isHot ? 2500 : 1000,
            executionsPerHour: isHot ? 10 : 0,
            avgGasPerExecution: 200,
            lastExecutedAt: isHot ? now - 30_000 : now - 10_000_000,
            isActive: true,
          });
        }
      }

      const start = Date.now();
      const { summary } = await rebalancer.rebalanceAll(tasks, { now });
      const elapsedMs = Date.now() - start;

      expect(summary.confirmedCount).toBeGreaterThanOrEqual(100);
      expect(summary.failedCount).toBe(0);
      expect(summary.totalMoved).toBe(240_000);
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});

const { RetryBudget } = require('../src/retryBudget');

describe('RetryBudget', () => {
  let budget;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.GLOBAL_RETRY_BUDGET = '10';
    process.env.GLOBAL_BUDGET_WINDOW_MS = '60000';
    process.env.TASK_RETRY_BUDGET = '3';
    process.env.TASK_BUDGET_WINDOW_MS = '60000';
    process.env.BUDGET_COOLDOWN_MS = '5000';
    process.env.BUDGET_WARNING_THRESHOLD = '0.8';

    budget = new RetryBudget();
    budget.setLogger({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });

    await budget.initialize();
    budget.globalConsumption = [];
    budget.taskConsumption = new Map();
    budget.cooldownUntil = null;
    budget.totalExhaustedEvents = 0;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should initialize with default config', async () => {
      await budget.initialize();

      expect(budget.initialized).toBe(true);
      expect(budget.config.globalRetryBudget).toBe(10);
      expect(budget.config.taskRetryBudget).toBe(3);
    });

    it('should allow custom config override', async () => {
      const customBudget = new RetryBudget({
        globalRetryBudget: 100,
        taskRetryBudget: 50,
      });
      customBudget.setLogger(budget.logger);

      await customBudget.initialize();

      expect(customBudget.config.globalRetryBudget).toBe(100);
      expect(customBudget.config.taskRetryBudget).toBe(50);
    });
  });

  describe('global budget tracking', () => {
    it('should allow retries when under global limit', async () => {
      await budget.initialize();

      const result = budget.canRetry();

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block retries when global limit reached', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }

      const result = budget.canRetry();

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('global_exhausted');
    });

    it('should correctly report global pressure', async () => {
      await budget.initialize();

      budget.recordRetry();
      budget.recordRetry();
      budget.recordRetry();

      const pressure = budget.getGlobalPressure();

      expect(pressure.used).toBe(3);
      expect(pressure.limit).toBe(10);
      expect(pressure.percentage).toBe(0.3);
      expect(pressure.available).toBe(0.7);
    });
  });

  describe('per-task budget tracking', () => {
    it('should track per-task consumption separately', async () => {
      await budget.initialize();

      budget.recordRetry(1);
      budget.recordRetry(1);
      budget.recordRetry(2);

      expect(budget.getTaskConsumption(1)).toBe(2);
      expect(budget.getTaskConsumption(2)).toBe(1);
      expect(budget.getTaskConsumption(999)).toBe(0);
    });

    it('should block retries for exhausted task', async () => {
      await budget.initialize();

      for (let i = 0; i < 3; i++) {
        budget.recordRetry(100);
      }

      const result = budget.canRetry(100);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('task_exhausted');
    });

    it('should allow retries for non-exhausted tasks when one task is exhausted', async () => {
      await budget.initialize();

      for (let i = 0; i < 3; i++) {
        budget.recordRetry(100);
      }

      const result = budget.canRetry(200);

      expect(result.allowed).toBe(true);
    });

    it('should correctly report per-task pressure', async () => {
      await budget.initialize();

      budget.recordRetry(50);

      const pressure = budget.getTaskPressure(50);

      expect(pressure.used).toBe(1);
      expect(pressure.limit).toBe(3);
      expect(pressure.percentage).toBeCloseTo(0.33, 2);
    });
  });

  describe('sliding window expiration', () => {
    it('should track consumption with timestamps', async () => {
      await budget.initialize();

      budget.recordRetry();

      const consumption = budget.getGlobalConsumption();
      expect(consumption).toBe(1);
    });

    it('should filter expired entries on cleanup', async () => {
      await budget.initialize();

      budget.recordRetry();
      expect(budget.getGlobalConsumption()).toBe(1);

      budget.globalConsumption = [
        { timestamp: Date.now() - 120000, count: 5 },
      ];

      budget.cleanupExpired();

      expect(budget.getGlobalConsumption()).toBe(0);
    });
  });

  describe('cooldown mechanism', () => {
    it('should activate cooldown when global budget exhausted', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }

      budget.canRetry();

      expect(budget.isInCooldown()).toBe(true);
      expect(budget.getCooldownRemainingMs()).toBeGreaterThan(0);
    });

    it('should block retries during cooldown', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }
      budget.canRetry();

      const result = budget.canRetry();

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('cooldown');
      expect(result.cooldownRemainingMs).toBeGreaterThan(0);
    });

    it('should release from cooldown after duration expires', async () => {
      await budget.initialize();

      budget.cooldownUntil = Date.now() - 1000;

      expect(budget.isInCooldown()).toBe(false);
    });
  });

  describe('pressure level calculation', () => {
    it('should return low pressure under 50%', async () => {
      await budget.initialize();

      budget.recordRetry();
      budget.recordRetry();

      expect(budget.getPressureLevel()).toBe('low');
    });

    it('should return medium pressure between 50% and warning threshold', async () => {
      await budget.initialize();

      for (let i = 0; i < 6; i++) {
        budget.recordRetry();
      }

      expect(budget.getPressureLevel()).toBe('medium');
    });

    it('should return high pressure above warning threshold', async () => {
      await budget.initialize();

      for (let i = 0; i < 9; i++) {
        budget.recordRetry();
      }

      expect(budget.getPressureLevel()).toBe('high');
    });

    it('should return critical at 95% or above', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }

      budget.cleanupExpired();
      expect(budget.getPressureLevel()).toBe('critical');
    });
  });

  describe('exhaustion tracking', () => {
    it('should count exhaustion events', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }
      budget.canRetry();

      expect(budget.totalExhaustedEvents).toBe(1);

      budget.cooldownUntil = null;

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }
      budget.canRetry();

      expect(budget.totalExhaustedEvents).toBe(2);
    });

    it('should record exhaustion via dedicated method', async () => {
      await budget.initialize();

      budget.recordBudgetExhaustion('global');

      expect(budget.totalExhaustedEvents).toBe(1);
    });
  });

  describe('stats reporting', () => {
    it('should return comprehensive stats', async () => {
      await budget.initialize();

      budget.recordRetry(1);
      budget.recordRetry(1);
      budget.recordRetry(2);

      const stats = budget.getStats();

      expect(stats.global).toBeDefined();
      expect(stats.global.used).toBe(3);
      expect(stats.global.limit).toBe(10);
      expect(stats.taskCount).toBe(2);
      expect(stats.cooldownActive).toBe(false);
      expect(stats.pressure).toBe('low');
    });
  });

  describe('interaction with global and task budgets', () => {
    it('should check both global and task budgets', async () => {
      await budget.initialize();

      expect(budget.canRetry(50).allowed).toBe(true);

      for (let i = 0; i < 3; i++) {
        budget.recordRetry(50);
      }

      expect(budget.canRetry(50).allowed).toBe(false);
      expect(budget.canRetry(51).allowed).toBe(true);
    });

    it('should prioritize global exhaustion over task exhaustion', async () => {
      await budget.initialize();

      for (let i = 0; i < 10; i++) {
        budget.recordRetry();
      }

      const firstResult = budget.canRetry(999);
      expect(firstResult.allowed).toBe(false);
      expect(firstResult.reason).toBe('global_exhausted');

      const secondResult = budget.canRetry(999);
      expect(secondResult.allowed).toBe(false);
      expect(secondResult.reason).toBe('cooldown');
    });
  });

  describe('releaseRetry', () => {
    it('should exist as a no-op method', async () => {
      await budget.initialize();

      budget.recordRetry(100);
      expect(budget.getTaskConsumption(100)).toBe(1);

      budget.releaseRetry(100);

      expect(budget.getTaskConsumption(100)).toBe(1);
    });
  });
});
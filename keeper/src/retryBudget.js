const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BUDGET_STORAGE_FILE = path.join(DATA_DIR, 'retry-budget.json');

function getDefaultConfig() {
  return {
    globalRetryBudget: parseInt(process.env.GLOBAL_RETRY_BUDGET, 10) || 1000,
    globalBudgetWindowMs: parseInt(process.env.GLOBAL_BUDGET_WINDOW_MS, 10) || 3600000,
    taskRetryBudget: parseInt(process.env.TASK_RETRY_BUDGET, 10) || 10,
    taskBudgetWindowMs: parseInt(process.env.TASK_BUDGET_WINDOW_MS, 10) || 3600000,
    budgetCooldownMs: parseInt(process.env.BUDGET_COOLDOWN_MS, 10) || 60000,
    budgetWarningThreshold: parseFloat(process.env.BUDGET_WARNING_THRESHOLD) || 0.8,
    storagePath: process.env.RETRY_BUDGET_STORAGE_PATH || './data/retry-budget.json',
  };
}

class RetryBudget {
  constructor(config = {}) {
    this.config = { ...getDefaultConfig(), ...config };
    this.initialized = false;

    this.globalConsumption = [];
    this.taskConsumption = new Map();
    this.cooldownUntil = null;
    this.totalExhaustedEvents = 0;

    this.logger = console;
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await this.load();
      this.initialized = true;
      this.logger.info('RetryBudget initialized', {
        globalLimit: this.config.globalRetryBudget,
        globalWindowMs: this.config.globalBudgetWindowMs,
        taskLimit: this.config.taskRetryBudget,
        taskWindowMs: this.config.taskBudgetWindowMs,
      });
    } catch (error) {
      this.logger.warn('Failed to load retry budget from disk, starting fresh', {
        error: error.message,
      });
      this.initialized = true;
    }
  }

  async load() {
    const storagePath = this.config.storagePath || BUDGET_STORAGE_FILE;

    try {
      const data = await fs.readFile(storagePath, 'utf8');
      const saved = JSON.parse(data);

      const now = Date.now();

      this.globalConsumption = (saved.globalConsumption || [])
        .filter((entry) => now - entry.timestamp < this.config.globalBudgetWindowMs)
        .map((entry) => ({
          timestamp: entry.timestamp,
          count: entry.count,
        }));

      this.taskConsumption = new Map();
      if (saved.taskConsumption) {
        for (const [taskId, entries] of Object.entries(saved.taskConsumption)) {
          const filtered = entries
            .filter((entry) => now - entry.timestamp < this.config.taskBudgetWindowMs)
            .map((entry) => ({
              timestamp: entry.timestamp,
              count: entry.count,
            }));
          if (filtered.length > 0) {
            this.taskConsumption.set(parseInt(taskId, 10), filtered);
          }
        }
      }

      this.cooldownUntil = saved.cooldownUntil || null;
      this.totalExhaustedEvents = saved.totalExhaustedEvents || 0;

      this.cleanupExpired();

      this.logger.info('Loaded retry budget from disk', {
        globalEntries: this.globalConsumption.length,
        taskEntries: this.taskConsumption.size,
        inCooldown: this.isInCooldown(),
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.globalConsumption = [];
        this.taskConsumption = new Map();
        this.cooldownUntil = null;
        this.totalExhaustedEvents = 0;
      } else {
        throw error;
      }
    }
  }

  async save() {
    const storagePath = this.config.storagePath || BUDGET_STORAGE_FILE;

    try {
      const dir = path.dirname(storagePath);
      await fs.mkdir(dir, { recursive: true });

      const taskConsumptionObj = {};
      for (const [taskId, entries] of this.taskConsumption) {
        taskConsumptionObj[taskId] = entries;
      }

      const data = {
        globalConsumption: this.globalConsumption,
        taskConsumption: taskConsumptionObj,
        cooldownUntil: this.cooldownUntil,
        totalExhaustedEvents: this.totalExhaustedEvents,
        savedAt: new Date().toISOString(),
      };

      await fs.writeFile(storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn('Failed to persist retry budget', { error: error.message });
    }
  }

  cleanupExpired() {
    const now = Date.now();

    const beforeGlobal = this.globalConsumption.length;
    this.globalConsumption = this.globalConsumption.filter(
      (entry) => now - entry.timestamp < this.config.globalBudgetWindowMs
    );

    for (const [taskId, entries] of this.taskConsumption) {
      const filtered = entries.filter(
        (entry) => now - entry.timestamp < this.config.taskBudgetWindowMs
      );
      if (filtered.length === 0) {
        this.taskConsumption.delete(taskId);
      } else {
        this.taskConsumption.set(taskId, filtered);
      }
    }

    if (this.cooldownUntil && now > this.cooldownUntil) {
      this.cooldownUntil = null;
    }
  }

  getGlobalConsumption() {
    this.cleanupExpired();
    return this.globalConsumption.reduce((sum, entry) => sum + entry.count, 0);
  }

  getTaskConsumption(taskId) {
    const entries = this.taskConsumption.get(taskId) || [];
    const now = Date.now();
    const validEntries = entries.filter(
      (entry) => now - entry.timestamp < this.config.taskBudgetWindowMs
    );
    return validEntries.reduce((sum, entry) => sum + entry.count, 0);
  }

  getGlobalPressure() {
    const used = this.getGlobalConsumption();
    const limit = this.config.globalRetryBudget;
    const percentage = limit > 0 ? used / limit : 1;

    return {
      used,
      limit,
      percentage: Math.round(percentage * 100) / 100,
      available: Math.max(0, 1 - percentage),
    };
  }

  getTaskPressure(taskId) {
    const used = this.getTaskConsumption(taskId);
    const limit = this.config.taskRetryBudget;
    const percentage = limit > 0 ? used / limit : 1;

    return {
      used,
      limit,
      percentage: Math.round(percentage * 100) / 100,
      available: Math.max(0, 1 - percentage),
    };
  }

  isGlobalExhausted() {
    const { percentage } = this.getGlobalPressure();
    return percentage >= 1;
  }

  isTaskExhausted(taskId) {
    const { percentage } = this.getTaskPressure(taskId);
    return percentage >= 1;
  }

  isInCooldown() {
    if (!this.cooldownUntil) return false;
    return Date.now() < this.cooldownUntil;
  }

  getCooldownRemainingMs() {
    if (!this.cooldownUntil) return 0;
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  canRetry(taskId = null) {
    this.cleanupExpired();

    if (this.isInCooldown()) {
      return {
        allowed: false,
        reason: 'cooldown',
        cooldownRemainingMs: this.getCooldownRemainingMs(),
      };
    }

    if (this.isGlobalExhausted()) {
      this.totalExhaustedEvents++;
      this.activateCooldown();
      return {
        allowed: false,
        reason: 'global_exhausted',
        globalPressure: this.getGlobalPressure(),
      };
    }

    if (taskId !== null && this.isTaskExhausted(taskId)) {
      return {
        allowed: false,
        reason: 'task_exhausted',
        taskPressure: this.getTaskPressure(taskId),
      };
    }

    return {
      allowed: true,
    };
  }

  activateCooldown() {
    this.cooldownUntil = Date.now() + this.config.budgetCooldownMs;
    this.logger.warn('Retry budget cooldown activated', {
      cooldownUntil: new Date(this.cooldownUntil).toISOString(),
      cooldownMs: this.config.budgetCooldownMs,
    });
  }

  recordRetry(taskId = null) {
    const now = Date.now();

    this.globalConsumption.push({
      timestamp: now,
      count: 1,
    });

    if (taskId !== null) {
      const entries = this.taskConsumption.get(taskId) || [];
      entries.push({
        timestamp: now,
        count: 1,
      });
      this.taskConsumption.set(taskId, entries);
    }

    this.save();
  }

  releaseRetry(taskId = null) {
  }

  recordBudgetExhaustion(scope = 'global') {
    this.totalExhaustedEvents++;
    this.save();
  }

  getPressureLevel() {
    const { percentage } = this.getGlobalPressure();

    if (percentage >= 0.95) return 'critical';
    if (percentage >= this.config.budgetWarningThreshold) return 'high';
    if (percentage >= 0.5) return 'medium';
    return 'low';
  }

  getStats() {
    this.cleanupExpired();

    return {
      global: this.getGlobalPressure(),
      taskCount: this.taskConsumption.size,
      cooldownActive: this.isInCooldown(),
      cooldownRemainingMs: this.getCooldownRemainingMs(),
      pressure: this.getPressureLevel(),
      totalExhaustedEvents: this.totalExhaustedEvents,
      warningThreshold: this.config.budgetWarningThreshold,
    };
  }

  async shutdown() {
    await this.save();
    this.logger.info('RetryBudget persisted on shutdown');
  }
}

module.exports = { RetryBudget, getDefaultConfig };
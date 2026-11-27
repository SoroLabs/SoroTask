'use strict';

/**
 * Blue/Green canary rollout controller.
 *
 * Shifts live traffic from the stable color (e.g. "blue") to the candidate
 * color (e.g. "green") in weighted steps (10% -> 50% -> 100% by default),
 * evaluating the candidate's 5xx error rate on a short interval. The moment
 * the error rate breaches the threshold (0.5% by default) the controller
 * routes 100% of traffic back to the stable color. The whole detect-and-revert
 * path is budgeted to finish inside `rollbackDeadlineMs` (15s by default).
 *
 * The controller is deliberately I/O free: traffic routing, telemetry and the
 * clock are injected, so the same code runs against the AWS ALB in the deploy
 * pipeline and against in-memory mocks in unit, integration and stress tests.
 */

const DEFAULTS = Object.freeze({
  steps: [10, 50, 100],
  // How long each traffic step must stay healthy before moving on.
  stepHoldMs: 60000,
  // How often telemetry is evaluated while a step is held.
  evaluationIntervalMs: 5000,
  // Worst-case age of the newest telemetry sample (Prometheus scrape interval).
  telemetryLagMs: 5000,
  // Upper bound for a single routing call (ALB modify-listener).
  routerTimeoutMs: 4000,
  // 5xx rate that triggers rollback (0.005 === 0.5%). A rate strictly above
  // the threshold is a breach.
  errorRateThreshold: 0.005,
  // Maximum time from an anomaly appearing in telemetry to traffic being
  // fully back on the stable color.
  rollbackDeadlineMs: 15000,
  // Statistical floor: a window is only judged once it holds at least this
  // many 5xx responses. Without it a single error among a handful of canary
  // requests (1 of 100 = 1%) would roll back a healthy release. With a 0.1%
  // background error rate the chance of 5 errors in a 10s window at 10%
  // canary traffic is ~1e-5, while a real 1% fault reaches it in seconds at
  // production volume.
  minErrorsForBreach: 5,
  // Consecutive telemetry read failures tolerated before treating the
  // rollout as unobservable (and rolling back).
  maxTelemetryFailures: 1,
});

class CanaryConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanaryConfigError';
  }
}

function normalizeConfig(overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  config.steps = [...(overrides.steps || DEFAULTS.steps)].map(Number);
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const { steps } = config;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new CanaryConfigError('steps must be a non-empty array of percentages');
  }
  let previous = 0;
  for (const step of steps) {
    if (!Number.isFinite(step) || step <= 0 || step > 100) {
      throw new CanaryConfigError(`invalid traffic step ${step}; must be in (0, 100]`);
    }
    if (step <= previous) {
      throw new CanaryConfigError('traffic steps must be strictly increasing');
    }
    previous = step;
  }
  if (steps[steps.length - 1] !== 100) {
    throw new CanaryConfigError('the final traffic step must be 100');
  }
  if (!(config.errorRateThreshold > 0 && config.errorRateThreshold < 1)) {
    throw new CanaryConfigError('errorRateThreshold must be between 0 and 1');
  }
  if (!(Number.isInteger(config.minErrorsForBreach) && config.minErrorsForBreach >= 1)) {
    throw new CanaryConfigError('minErrorsForBreach must be a positive integer');
  }
  for (const key of ['stepHoldMs', 'evaluationIntervalMs', 'rollbackDeadlineMs']) {
    if (!(Number.isFinite(config[key]) && config[key] > 0)) {
      throw new CanaryConfigError(`${key} must be a positive number`);
    }
  }
  const worstCase = rollbackBudgetMs(config);
  if (worstCase > config.rollbackDeadlineMs) {
    throw new CanaryConfigError(
      `rollback budget ${worstCase}ms (telemetryLag + evaluationInterval + routerTimeout) ` +
        `exceeds rollbackDeadlineMs ${config.rollbackDeadlineMs}ms`,
    );
  }
}

/**
 * Worst-case time between an anomaly starting and traffic being reverted:
 * the anomaly must first show up in telemetry, then be picked up by the next
 * evaluation tick, then the router call must complete.
 */
function rollbackBudgetMs(config) {
  return config.telemetryLagMs + config.evaluationIntervalMs + config.routerTimeoutMs;
}

/**
 * Pure decision for one telemetry window.
 * @param {{requests:number, errors5xx:number}} window
 * @returns {{breach:boolean, errorRate:number, reason:string}}
 */
function evaluateWindow(window, config = DEFAULTS) {
  const requests = Math.max(0, Number(window?.requests) || 0);
  const errors = Math.max(0, Number(window?.errors5xx) || 0);
  const errorRate = requests > 0 ? errors / requests : errors > 0 ? 1 : 0;

  if (errors < config.minErrorsForBreach) {
    return { breach: false, errorRate, reason: errors === 0 ? 'healthy' : 'below_error_floor' };
  }
  const breach = errorRate > config.errorRateThreshold;
  return { breach, errorRate, reason: breach ? 'error_rate_breach' : 'healthy' };
}

/** Weights for the router given the candidate's share of traffic. */
function weightsFor(stableColor, candidateColor, candidatePercent) {
  const candidate = Math.round(candidatePercent);
  return { [stableColor]: 100 - candidate, [candidateColor]: candidate };
}

function systemClock() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

class CanaryController {
  /**
   * @param {object} deps
   * @param {{setWeights:(weights:Object<string,number>)=>Promise<void>}} deps.router
   * @param {{read:(color:string)=>Promise<{requests:number, errors5xx:number}>}} deps.telemetry
   * @param {{now:()=>number, sleep:(ms:number)=>Promise<void>}} [deps.clock]
   * @param {object} [deps.logger]
   * @param {string} deps.stableColor
   * @param {string} deps.candidateColor
   * @param {object} [deps.config]
   */
  constructor({ router, telemetry, clock, logger, stableColor = 'blue', candidateColor = 'green', config } = {}) {
    if (!router || typeof router.setWeights !== 'function') {
      throw new CanaryConfigError('router.setWeights is required');
    }
    if (!telemetry || typeof telemetry.read !== 'function') {
      throw new CanaryConfigError('telemetry.read is required');
    }
    if (!stableColor || !candidateColor || stableColor === candidateColor) {
      throw new CanaryConfigError('stableColor and candidateColor must be distinct');
    }
    this.router = router;
    this.telemetry = telemetry;
    this.clock = clock || systemClock();
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.stableColor = stableColor;
    this.candidateColor = candidateColor;
    this.config = normalizeConfig(config);
    this.events = [];
  }

  _record(type, data = {}) {
    const event = { type, at: this.clock.now(), ...data };
    this.events.push(event);
    return event;
  }

  async _route(candidatePercent) {
    const weights = weightsFor(this.stableColor, this.candidateColor, candidatePercent);
    await withTimeout(
      Promise.resolve(this.router.setWeights(weights)),
      this.config.routerTimeoutMs,
      'router.setWeights',
    );
    this._record('route', { weights });
    return weights;
  }

  async _rollback(trigger) {
    const startedAt = this.clock.now();
    this.logger.warn('Canary anomaly detected, rolling back', {
      candidate: this.candidateColor,
      ...trigger,
    });
    let lastError;
    // Rollback must not give up on a transient router failure: retry inside
    // the deadline, then surface the failure loudly.
    while (this.clock.now() - startedAt < this.config.rollbackDeadlineMs) {
      try {
        await this._route(0);
        const durationMs = this.clock.now() - startedAt;
        this._record('rollback', { durationMs, ...trigger });
        return durationMs;
      } catch (error) {
        lastError = error;
        this.logger.error('Rollback routing attempt failed', { error: error.message });
        await this.clock.sleep(250);
      }
    }
    const err = new Error(`rollback did not complete within ${this.config.rollbackDeadlineMs}ms: ${lastError?.message}`);
    err.code = 'ROLLBACK_FAILED';
    throw err;
  }

  /**
   * Run the full rollout. Resolves with a result object; only rejects when a
   * rollback itself could not be completed (the operator must intervene).
   */
  async run() {
    const { steps, stepHoldMs, evaluationIntervalMs, maxTelemetryFailures } = this.config;
    const startedAt = this.clock.now();
    this._record('start', { stable: this.stableColor, candidate: this.candidateColor, steps });

    for (const step of steps) {
      try {
        await this._route(step);
      } catch (error) {
        const rollbackMs = await this._rollback({ reason: 'routing_failed', step, error: error.message });
        return this._result('rolled_back', { step, reason: 'routing_failed', rollbackMs, startedAt });
      }
      this.logger.info('Traffic shifted to candidate', { step, candidate: this.candidateColor });

      const stepStartedAt = this.clock.now();
      let telemetryFailures = 0;
      // Evaluate on every tick until the step has been held long enough.
      // The last evaluation happens at (or after) the end of the hold window.
      for (;;) {
        await this.clock.sleep(evaluationIntervalMs);
        let window;
        try {
          window = await this.telemetry.read(this.candidateColor);
          telemetryFailures = 0;
        } catch (error) {
          telemetryFailures += 1;
          this._record('telemetry_error', { step, error: error.message });
          if (telemetryFailures > maxTelemetryFailures) {
            const rollbackMs = await this._rollback({ reason: 'telemetry_unavailable', step });
            return this._result('rolled_back', { step, reason: 'telemetry_unavailable', rollbackMs, startedAt });
          }
          continue;
        }

        const decision = evaluateWindow(window, this.config);
        this._record('evaluate', { step, ...window, ...decision });
        if (decision.breach) {
          const rollbackMs = await this._rollback({
            reason: decision.reason,
            step,
            errorRate: decision.errorRate,
          });
          return this._result('rolled_back', {
            step,
            reason: decision.reason,
            errorRate: decision.errorRate,
            rollbackMs,
            startedAt,
          });
        }
        if (this.clock.now() - stepStartedAt >= stepHoldMs) break;
      }
    }

    this._record('promoted', { candidate: this.candidateColor });
    return this._result('promoted', { step: 100, startedAt });
  }

  _result(outcome, { startedAt, ...rest }) {
    return {
      outcome,
      stableColor: this.stableColor,
      candidateColor: this.candidateColor,
      liveColor: outcome === 'promoted' ? this.candidateColor : this.stableColor,
      durationMs: this.clock.now() - startedAt,
      ...rest,
      events: this.events,
    };
  }
}

module.exports = {
  CanaryController,
  CanaryConfigError,
  DEFAULTS,
  evaluateWindow,
  normalizeConfig,
  rollbackBudgetMs,
  weightsFor,
};

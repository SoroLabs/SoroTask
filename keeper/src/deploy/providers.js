'use strict';

/**
 * I/O adapters for the canary controller.
 *
 * - AwsAlbWeightedRouter (./albRouter.js, re-exported here): shifts traffic
 *   on the ALB listener provisioned in terraform/services.tf.
 * - PrometheusTelemetry: reads request and 5xx counts for one color from the
 *   in-cluster Prometheus (5s scrape interval).
 * - SimulatedFleet: deterministic in-memory stand-in used by the pipeline's
 *   dry-run mode and by the integration/stress tests.
 */

const { AwsAlbWeightedRouter } = require('./albRouter');

class PrometheusTelemetry {
  /**
   * @param {object} options
   * @param {string} options.baseUrl e.g. http://prometheus-server.monitoring.svc:9090
   * @param {string} [options.window] PromQL range, kept short for fast detection
   * @param {string} [options.metric] counter with `status` (2xx..5xx) and color labels
   * @param {string} [options.colorLabel]
   * @param {Function} [options.fetchImpl]
   */
  constructor({
    baseUrl,
    window = '10s',
    metric = 'keeper_http_responses_total',
    colorLabel = 'deployment_color',
    fetchImpl,
  } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.window = window;
    this.metric = metric;
    this.colorLabel = colorLabel;
    this.fetch = fetchImpl || fetch;
  }

  queries(color) {
    const selector = `${this.colorLabel}="${color}"`;
    return {
      requests: `sum(increase(${this.metric}{${selector}}[${this.window}]))`,
      errors5xx: `sum(increase(${this.metric}{${selector},status="5xx"}[${this.window}]))`,
    };
  }

  async _scalar(query) {
    const url = `${this.baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`prometheus query failed with HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'success') throw new Error(`prometheus query error: ${body.error || 'unknown'}`);
    const sample = body.data?.result?.[0]?.value?.[1];
    return sample === undefined ? 0 : Number(sample);
  }

  async read(color) {
    const q = this.queries(color);
    const [requests, errors5xx] = await Promise.all([this._scalar(q.requests), this._scalar(q.errors5xx)]);
    return { requests, errors5xx };
  }
}

/** Small seeded PRNG (mulberry32) so simulations are reproducible. */
function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-memory fleet: acts as both router and telemetry. Requests arrive at
 * `rps`; each is routed by the current weights and fails with the color's
 * configured 5xx probability (which may change over time via `faults`).
 */
class SimulatedFleet {
  constructor({ clock, rps = 200, windowMs = 10000, errorRates = {}, faults = [], seed = 42, retainAll = false } = {}) {
    this.clock = clock;
    this.rps = rps;
    this.windowMs = windowMs;
    this.errorRates = { ...errorRates };
    this.faults = [...faults].sort((a, b) => a.at - b.at);
    this.random = seededRandom(seed);
    this.weights = {};
    this.samples = []; // { at, color, ok }
    this.lastTick = clock.now();
    this.routeHistory = [];
    this.retainAll = retainAll;
    this.totalRequests = 0;
  }

  _errorRate(color, at) {
    let rate = this.errorRates[color] || 0;
    for (const fault of this.faults) {
      if (fault.color === color && at >= fault.at) rate = fault.errorRate;
    }
    return rate;
  }

  /** Generate traffic from the last tick up to now. */
  advance() {
    const now = this.clock.now();
    const elapsed = now - this.lastTick;
    const count = Math.floor((elapsed / 1000) * this.rps);
    const colors = Object.keys(this.weights);
    for (let i = 0; i < count; i += 1) {
      const at = this.lastTick + Math.floor((i / Math.max(count, 1)) * elapsed);
      let pick = this.random() * 100;
      let color = colors[0];
      for (const c of colors) {
        pick -= this.weights[c];
        if (pick < 0) {
          color = c;
          break;
        }
      }
      if (!color) continue;
      const ok = this.random() >= this._errorRate(color, at);
      this.samples.push({ at, color, ok });
    }
    this.lastTick = now;
    // Keep only what the telemetry window can see (plus all samples when
    // `retainAll` is set, for request-accounting assertions in tests).
    if (!this.retainAll) {
      const cutoff = now - this.windowMs;
      let drop = 0;
      while (drop < this.samples.length && this.samples[drop].at < cutoff) drop += 1;
      if (drop > 0) this.samples.splice(0, drop);
    }
    this.totalRequests += count;
  }

  async setWeights(weights) {
    this.advance();
    this.weights = { ...weights };
    this.routeHistory.push({ at: this.clock.now(), weights: { ...weights } });
  }

  async read(color) {
    this.advance();
    const since = this.clock.now() - this.windowMs;
    let requests = 0;
    let errors5xx = 0;
    for (const s of this.samples) {
      if (s.color === color && s.at >= since) {
        requests += 1;
        if (!s.ok) errors5xx += 1;
      }
    }
    return { requests, errors5xx };
  }
}

/** Fake clock: sleep advances virtual time instantly. */
function createVirtualClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

module.exports = {
  AwsAlbWeightedRouter,
  PrometheusTelemetry,
  SimulatedFleet,
  createVirtualClock,
  seededRandom,
};

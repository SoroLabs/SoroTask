/**
 * SyntheticMonitor — end-to-end task lifecycle monitoring.
 *
 * The lifecycle adapter must registerTask, pollTask, executeTask, verifyIndexed,
 * and cleanupTask. Deployments provide it with SYNTHETIC_CANARY_ADAPTER_MODULE.
 */

const path = require('path');
const https = require('https');
const http = require('http');
const { recordSyntheticCanary } = require('./metrics');

// ---------------------------------------------------------------------------
// Alert helpers
// ---------------------------------------------------------------------------

/**
 * Fire a webhook alert by POSTing a JSON payload to the configured URL.
 * Failures are logged but never throw — monitoring must not crash the indexer.
 *
 * @param {string} webhookUrl
 * @param {object} payload
 */
function fireWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;

  const body = JSON.stringify(payload);
  const url = new URL(webhookUrl);
  const lib = url.protocol === 'https:' ? https : http;

  const req = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      res.resume(); // drain
      if (res.statusCode >= 400) {
        console.error(`[SyntheticMonitor] Webhook returned HTTP ${res.statusCode}`);
      }
    }
  );

  req.on('error', (err) =>
    console.error('[SyntheticMonitor] Webhook request failed:', err.message)
  );
  req.write(body);
  req.end();
}

function fireAlertmanager(alertmanagerUrl, probeId, error, resolved = false) {
  if (!alertmanagerUrl) return;

  let target;
  try {
    target = new URL(alertmanagerUrl);
  } catch (err) {
    console.error('[SyntheticMonitor] Invalid Alertmanager URL:', err.message);
    return;
  }
  if (!target.pathname || target.pathname === '/') target.pathname = '/api/v2/alerts';

  const now = new Date();
  const alert = {
    labels: {
      alertname: 'SyntheticCanaryFailure',
      service: 'sorotask-indexer',
      severity: 'critical',
    },
    annotations: {
      summary: resolved ? 'Synthetic canary recovered' : 'Synthetic canary failed',
      description: resolved ? 'The end-to-end synthetic task lifecycle recovered.' : String(error),
      probe_id: probeId,
    },
    startsAt: now.toISOString(),
    ...(resolved ? { endsAt: now.toISOString() } : {}),
  };
  const body = JSON.stringify([alert]);
  const protocol = target.protocol === 'https:' ? https : http;
  const req = protocol.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => {
    res.resume();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`[SyntheticMonitor] Alertmanager returned HTTP ${res.statusCode}`);
    }
  });
  req.setTimeout(5000, () => req.destroy(new Error('Alertmanager request timed out')));
  req.on('error', (err) => console.error('[SyntheticMonitor] Alertmanager request failed:', err.message));
  req.write(body);
  req.end();
}

/**
 * Emit a structured alert to stdout and optionally to a webhook.
 *
 * @param {'latency'|'timeout'|'error'} type
 * @param {object} details
 * @param {string|null} webhookUrl
 */
function alert(type, details, webhookUrl) {
  const payload = {
    alertType: 'SYNTHETIC_MONITOR',
    severity: 'WARNING',
    type,
    timestamp: new Date().toISOString(),
    ...details,
  };

  console.warn('[SyntheticMonitor] ALERT', JSON.stringify(payload));
  fireWebhook(webhookUrl, payload);
}

// ---------------------------------------------------------------------------
// Core class
// ---------------------------------------------------------------------------

class SyntheticMonitor {
  /**
   * @param {object} options
  * @param {object} options.lifecycle Adapter implementing registerTask, pollTask,
  * executeTask, verifyIndexed, and cleanupTask.
   */
  constructor(options = {}) {
    const adapterPath = process.env.SYNTHETIC_CANARY_ADAPTER_MODULE;
    this.lifecycleLoadError = null;
    this.lifecycle = options.lifecycle || null;
    if (!this.lifecycle && adapterPath) {
      try {
        this.lifecycle = require(path.resolve(adapterPath));
      } catch (err) {
        this.lifecycleLoadError = err;
      }
    }
    this.intervalMs = options.intervalMs ?? 10 * 60_000;
    this.latencyThresholdMs = options.latencyThresholdMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.webhookUrl = options.webhookUrl || process.env.SYNTHETIC_MONITOR_WEBHOOK_URL || null;
    this.alertmanagerUrl = options.alertmanagerUrl || process.env.ALERTMANAGER_URL || null;

    this._timer = null;
    this._running = false;
    this._probeCount = 0;
    this._alertCount = 0;
    this._failed = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start periodic synthetic probes. */
  start() {
    if (this._timer) return; // already running
    console.log(
      `[SyntheticMonitor] Starting — interval=${this.intervalMs}ms, ` +
      `latencyThreshold=${this.latencyThresholdMs}ms, timeout=${this.timeoutMs}ms`
    );
    this._runProbe(); // immediate first probe
    this._timer = setInterval(() => this._runProbe(), this.intervalMs);
  }

  /** Stop periodic probes. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      console.log('[SyntheticMonitor] Stopped.');
    }
  }

  // -------------------------------------------------------------------------
  // Probe logic
  // -------------------------------------------------------------------------

  async _runProbe() {
    if (this._running) return;
    this._running = true;
    this._probeCount += 1;
    const probeId = `synthetic-probe-${Date.now()}-${this._probeCount}`;
    console.log(`[SyntheticMonitor] Probe #${this._probeCount} started (id=${probeId})`);

    const startTime = Date.now();
    const abortController = new AbortController();
    let timeoutHandle;
    try {
      const requiredMethods = ['registerTask', 'pollTask', 'executeTask', 'verifyIndexed', 'cleanupTask'];
      const missing = requiredMethods.filter((method) => typeof this.lifecycle?.[method] !== 'function');
      if (this.lifecycleLoadError) throw new Error(`Failed to load canary adapter: ${this.lifecycleLoadError.message}`);
      if (missing.length) throw new Error(`Canary lifecycle adapter is missing: ${missing.join(', ')}`);

      await Promise.race([
        (async () => {
          const options = { probeId, timeoutMs: this.timeoutMs, signal: abortController.signal };
          let taskId;
          try {
            const registration = await this.lifecycle.registerTask(options);
            taskId = registration?.taskId ?? registration;
            if (taskId == null) throw new Error('Canary registration did not return a task ID');
            const polled = await this.lifecycle.pollTask({ ...options, taskId });
            if (polled === false || polled?.success === false) throw new Error(`Keeper did not poll canary task ${taskId}`);
            const executed = await this.lifecycle.executeTask({ ...options, taskId });
            if (executed === false || executed?.success === false) throw new Error(`Canary task ${taskId} failed to execute`);
            const verified = await this.lifecycle.verifyIndexed({ ...options, taskId });
            if (verified === false || verified?.success === false || verified?.verified === false) {
              throw new Error(`Indexer did not verify canary task ${taskId}`);
            }
          } finally {
            if (taskId != null) await this.lifecycle.cleanupTask({ ...options, taskId });
          }
        })(),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            abortController.abort();
            reject(new Error(`Canary lifecycle exceeded ${this.timeoutMs}ms`));
          }, this.timeoutMs);
        }),
      ]);

      const latencyMs = Date.now() - startTime;
      if (latencyMs > this.latencyThresholdMs) {
        throw new Error(`Canary latency ${latencyMs}ms exceeded ${this.latencyThresholdMs}ms`);
      }
      recordSyntheticCanary({ success: true, durationMs: latencyMs });
      if (this._failed) fireAlertmanager(this.alertmanagerUrl, probeId, null, true);
      this._failed = false;
      console.log(`[SyntheticMonitor] Probe #${this._probeCount} verified in ${latencyMs}ms`);
    } catch (err) {
      console.error(`[SyntheticMonitor] Probe #${this._probeCount} failed:`, err.message);
      alert('error', { probeId, reason: err.message }, this.webhookUrl);
      recordSyntheticCanary({ success: false, durationMs: Date.now() - startTime });
      fireAlertmanager(this.alertmanagerUrl, probeId, err.message);
      this._failed = true;
      this._alertCount += 1;
    } finally {
      clearTimeout(timeoutHandle);
      this._running = false;
    }
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  get stats() {
    return { probeCount: this._probeCount, alertCount: this._alertCount };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const monitor = new SyntheticMonitor({
    intervalMs: Number(process.env.SYNTHETIC_INTERVAL_MS || 10 * 60_000),
    latencyThresholdMs: Number(process.env.SYNTHETIC_LATENCY_THRESHOLD_MS || 30_000),
    timeoutMs: Number(process.env.SYNTHETIC_TIMEOUT_MS || 120_000),
    webhookUrl: process.env.SYNTHETIC_MONITOR_WEBHOOK_URL || null,
  });

  monitor.start();

  process.on('SIGINT', () => {
    monitor.stop();
    console.log('Stats:', monitor.stats);
    process.exit(0);
  });
}

module.exports = { SyntheticMonitor };

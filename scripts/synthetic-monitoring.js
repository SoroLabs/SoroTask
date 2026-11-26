#!/usr/bin/env node
/**
 * Synthetic Monitoring Canary Probe Runner (BE-FINAL-42)
 *
 * Runs a 24/7 synthetic canary probe every 5 minutes (configurable) that:
 *   1. register  - registers a synthetic micro-task
 *   2. discover  - verifies keeper pickup
 *   3. execute   - asserts on-chain/keeper execution
 *   4. settle    - validates indexer ingestion
 *
 * Exposes continuous end-to-end latency metrics (Prometheus `/metrics` + JSON `/health`)
 * and dispatches instant SRE alerts on cycle failure.
 */

const http = require('http');
const {
  DEFAULT_SYNTHETIC_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LATENCY_SLO_MS,
  createSyntheticCanaryService,
} = require('../keeper/src/canaryProber');

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    once: false,
    simulate: env.CANARY_SIMULATE === 'true',
    network: env.CANARY_NETWORK || 'testnet',
    intervalMs: Number(env.CANARY_INTERVAL_MS || DEFAULT_SYNTHETIC_INTERVAL_MS),
    timeoutMs: Number(env.CANARY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    latencySloMs: Number(env.CANARY_LATENCY_SLO_MS || DEFAULT_LATENCY_SLO_MS),
    failuresBeforeAlert: Number(env.CANARY_FAILURES_BEFORE_ALERT || 1),
    metricsPort: env.CANARY_METRICS_PORT ? Number(env.CANARY_METRICS_PORT) : 0,
    webhookUrl: env.SRE_WEBHOOK_URL || null,
    rpcUrl: env.RPC_URL || null,
    keeperUrl: env.KEEPER_URL || null,
    indexerUrl: env.INDEXER_URL || null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--once') args.once = true;
    else if (token === '--simulate') args.simulate = true;
    else if (token === '--network' && argv[i + 1]) args.network = argv[++i];
    else if (token === '--interval-ms' && argv[i + 1]) args.intervalMs = Number(argv[++i]);
    else if (token === '--timeout-ms' && argv[i + 1]) args.timeoutMs = Number(argv[++i]);
    else if (token === '--slo-ms' && argv[i + 1]) args.latencySloMs = Number(argv[++i]);
    else if (token === '--failures-before-alert' && argv[i + 1]) args.failuresBeforeAlert = Number(argv[++i]);
    else if (token === '--metrics-port' && argv[i + 1]) args.metricsPort = Number(argv[++i]);
    else if (token === '--webhook-url' && argv[i + 1]) args.webhookUrl = argv[++i];
  }

  return args;
}

function buildSimulatedStages({ delayMs = 5 } = {}) {
  const pause = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  return {
    register: async (ctx) => {
      await pause();
      return { taskId: `micro-${ctx.cycleId}` };
    },
    discover: async (ctx) => {
      await pause();
      if (!ctx.taskId) throw new Error('missing taskId for keeper pickup');
      return { pickedUpBy: 'keeper-canary-sim' };
    },
    execute: async (ctx) => {
      await pause();
      if (!ctx.pickedUpBy) throw new Error('task was not picked up by keeper');
      return { txHash: `0xsim_${ctx.cycleId}`, executed: true };
    },
    settle: async (ctx) => {
      await pause();
      if (!ctx.txHash) throw new Error('missing txHash for indexer validation');
      return { indexed: true };
    },
  };
}

function buildHttpStages({
  rpcUrl,
  keeperUrl,
  indexerUrl,
  fetchFn = typeof fetch === 'function' ? fetch : null,
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is required for HTTP canary stages');
  }

  async function requestJson(url, options = {}) {
    const res = await fetchFn(url, {
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return res.json();
  }

  return {
    register: async (ctx) => {
      const data = await requestJson(`${rpcUrl.replace(/\/$/, '')}/tasks/micro`, {
        method: 'POST',
        body: JSON.stringify({ cycleId: ctx.cycleId, synthetic: true }),
      });
      if (!data.taskId) throw new Error('register response missing taskId');
      return { taskId: data.taskId };
    },
    discover: async (ctx) => {
      const data = await requestJson(`${keeperUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(ctx.taskId)}`);
      if (!data.pickedUp) throw new Error(`keeper did not pick up task ${ctx.taskId}`);
      return { pickedUpBy: data.keeperId || 'keeper' };
    },
    execute: async (ctx) => {
      const data = await requestJson(`${keeperUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(ctx.taskId)}/execution`);
      if (data.status !== 'executed' && !data.txHash) {
        throw new Error(`task ${ctx.taskId} execution not confirmed`);
      }
      return { txHash: data.txHash, executed: true };
    },
    settle: async (ctx) => {
      const data = await requestJson(`${indexerUrl.replace(/\/$/, '')}/events/${encodeURIComponent(ctx.taskId)}`);
      if (!data.indexed) throw new Error(`indexer did not ingest task ${ctx.taskId}`);
      return { indexed: true };
    },
  };
}

function startMetricsServer(service, port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(service.toPrometheusMetrics());
      return;
    }
    if (req.url === '/health') {
      const state = service.getState();
      const metrics = service.getMetrics();
      const code = state.incidentOpen ? 503 : 200;
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state, metrics }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

async function runSyntheticMonitoring(options = {}, logger = console) {
  const config = { ...parseArgs([], process.env), ...options };
  const useHttp = !config.simulate && config.rpcUrl && config.keeperUrl && config.indexerUrl;
  const stages = config.stages || (useHttp
    ? buildHttpStages({
      rpcUrl: config.rpcUrl,
      keeperUrl: config.keeperUrl,
      indexerUrl: config.indexerUrl,
    })
    : buildSimulatedStages());

  const service = createSyntheticCanaryService({
    stages,
    network: config.network,
    intervalMs: config.intervalMs,
    timeoutMs: config.timeoutMs,
    latencySloMs: config.latencySloMs,
    failuresBeforeAlert: config.failuresBeforeAlert,
    webhookUrl: config.webhookUrl,
    onAlert: (payload) => {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[SRE ALERT] ${JSON.stringify(payload)}`);
      }
    },
    onMetric: (name, value, tags) => {
      if (logger && typeof logger.info === 'function') {
        logger.info(`[METRIC] ${name}=${value}ms ${JSON.stringify(tags)}`);
      }
    },
  });

  let metricsServer = null;
  if (config.metricsPort > 0) {
    metricsServer = await startMetricsServer(service, config.metricsPort);
    if (logger && typeof logger.info === 'function') {
      logger.info(`[canary] metrics server listening on :${config.metricsPort}`);
    }
  }

  const firstResult = await service.tick();

  if (config.once) {
    if (metricsServer) {
      await new Promise((resolve) => metricsServer.close(resolve));
    }
    return { service, firstResult };
  }

  service.start();
  return {
    service,
    firstResult,
    metricsServer,
    stop: async () => {
      service.stop();
      if (metricsServer) {
        await new Promise((resolve) => metricsServer.close(resolve));
      }
    },
  };
}

if (require.main === module) {
  const args = parseArgs();
  runSyntheticMonitoring(args)
    .then(({ firstResult, stop }) => {
      if (args.once) {
        process.exit(firstResult && firstResult.healthy ? 0 : 1);
      }
      const shutdown = async () => {
        if (stop) await stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[canary] fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  buildSimulatedStages,
  buildHttpStages,
  startMetricsServer,
  runSyntheticMonitoring,
};

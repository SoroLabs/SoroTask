const {
  Contract,
  xdr,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc: SorobanRpc,
} = require('@stellar/stellar-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { createLogger } = require('./logger');

const DEFAULTS = {
  checkIntervalMs: 60000,
  minEvaluationWindow: 10,
  failureThreshold: 0.5,
  slashAmount: 100,
  enforcementCooldownMs: 60 * 60 * 1000,
  maxRecentHistory: 200,
};

function sendAlertmanagerAlert(alertmanagerUrl, violation, startsAt, resolved = false) {
  if (!alertmanagerUrl) return;

  let target;
  try {
    target = new URL(alertmanagerUrl);
  } catch (err) {
    return Promise.reject(new Error(`Invalid Alertmanager URL: ${err.message}`));
  }
  if (!target.pathname || target.pathname === '/') target.pathname = '/api/v2/alerts';

  const now = new Date().toISOString();
  const payload = JSON.stringify([{
    labels: {
      alertname: 'KeeperSLAViolation',
      service: 'sorotask-keeper',
      severity: 'critical',
      keeper: String(violation.keeper),
    },
    annotations: {
      summary: resolved ? 'Keeper SLA recovered' : 'Keeper SLA violation detected',
      description: resolved
        ? 'Keeper execution failures are below the configured threshold.'
        : `${violation.failures}/${violation.total} recent executions failed`,
    },
    startsAt: startsAt || now,
    ...(resolved ? { endsAt: now } : {}),
  }]);

  return new Promise((resolve, reject) => {
    const protocol = target.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`Alertmanager responded with status ${res.statusCode}`));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Alertmanager request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

class SLAMonitor {
  constructor(server, contractId, config = {}, options = {}) {
    this.server = server;
    this.contractId = contractId;
    this.config = config || {};
    this.historyManager = options.historyManager || null;
    this.metrics = options.metricsServer || null;
    this.logger = options.logger || createLogger('sla-monitor');
    this.alertmanagerUrl = options.alertmanagerUrl || process.env.ALERTMANAGER_URL || null;
    this.keypair = options.operatorKeypair || null;
    this.enabled = Boolean(this.config.slaMonitorEnabled);
    this.intervalMs = this.config.slaCheckIntervalMs || DEFAULTS.checkIntervalMs;
    this.minEvaluationWindow = this.config.slaMinEvaluationWindow || DEFAULTS.minEvaluationWindow;
    this.failureThreshold = Number(this.config.slaFailureThreshold) || DEFAULTS.failureThreshold;
    this.slashAmount = BigInt(this.config.slaSlashAmount || DEFAULTS.slashAmount);
    this.maxRecentHistory = this.config.slaMaxRecentHistory || DEFAULTS.maxRecentHistory;
    this.enforcementCooldownMs = this.config.slaEnforcementCooldownMs || DEFAULTS.enforcementCooldownMs;
    this.violationCache = new Map();
    this.alertedKeepers = new Map();
    this.timer = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger.info('SLA monitor disabled by configuration');
      return;
    }

    if (!this.server || !this.contractId) {
      this.logger.error('SLA monitor requires an RPC server and contract ID');
      return;
    }
    if (!this.keypair) {
      this.logger.error('SLA monitor requires an operator keypair for slashing');
      return;
    }
    if (!this.historyManager) {
      this.logger.error('SLA monitor requires a HistoryManager instance to evaluate performance');
      return;
    }

    this.logger.info('SLA monitor starting', {
      contractId: this.contractId,
      intervalMs: this.intervalMs,
      minEvaluationWindow: this.minEvaluationWindow,
      failureThreshold: this.failureThreshold,
      slashAmount: this.slashAmount.toString(),
    });

    await this.run();
    this.timer = setInterval(() => {
      this.run().catch((err) => {
        this.logger.error('SLA monitor cycle failed', { error: err.message });
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('SLA monitor stopped');
    }
  }

  async run() {
    const start = Date.now();
    this.metrics?.increment('slaChecksTotal', 1);

    const history = await this.historyManager.getRecent(this.maxRecentHistory);
    const keeperStats = this.analyzeHistory(history);
    const violations = Array.from(keeperStats.values()).filter((stats) => {
      return stats.total >= this.minEvaluationWindow && stats.failureRate >= this.failureThreshold;
    });

    this.metrics?.record('slaLastCheckDurationMs', Date.now() - start);

    const activeKeepers = new Set(violations.map((violation) => String(violation.keeper)));
    for (const [keeper, startsAt] of this.alertedKeepers) {
      if (activeKeepers.has(keeper)) continue;
      try {
        await sendAlertmanagerAlert(this.alertmanagerUrl, { keeper }, startsAt, true);
      } catch (err) {
        this.logger.error('Failed to resolve SLA alert in Alertmanager', { error: err.message });
      }
      this.alertedKeepers.delete(keeper);
    }

    if (violations.length === 0) {
      this.logger.debug('No SLA violations found in current evaluation window', {
        keepersEvaluated: keeperStats.size,
      });
      return;
    }

    for (const violation of violations) {
      const keeper = String(violation.keeper);
      const startsAt = this.alertedKeepers.get(keeper) || new Date().toISOString();
      try {
        await sendAlertmanagerAlert(this.alertmanagerUrl, violation, startsAt);
        this.alertedKeepers.set(keeper, startsAt);
      } catch (err) {
        this.logger.error('Failed to send SLA alert to Alertmanager', { error: err.message });
      }
      await this.enforceViolation(violation);
    }
  }

  analyzeHistory(history) {
    const statsByKeeper = new Map();

    for (const record of history) {
      if (!record || record.kind !== 'execution' || !record.keeper) {
        continue;
      }
      const keeper = record.keeper;
      const entry = statsByKeeper.get(keeper) || {
        keeper,
        total: 0,
        failures: 0,
        lastSeen: null,
      };
      entry.total += 1;
      entry.lastSeen = record.timestamp || entry.lastSeen;
      if (String(record.status).toUpperCase() !== 'SUCCESS') {
        entry.failures += 1;
      }
      statsByKeeper.set(keeper, entry);
    }

    for (const entry of statsByKeeper.values()) {
      entry.failureRate = entry.total > 0 ? entry.failures / entry.total : 0;
    }

    return statsByKeeper;
  }

  async enforceViolation(violation) {
    const now = Date.now();
    const lastEnforced = this.violationCache.get(violation.keeper);
    if (lastEnforced && now - lastEnforced < this.enforcementCooldownMs) {
      this.logger.debug('Skipping SLA enforcement due to cooldown', {
        keeper: violation.keeper,
        cooldownMs: this.enforcementCooldownMs,
      });
      return;
    }

    this.logger.warn('SLA violation detected', {
      keeper: violation.keeper,
      failureRate: violation.failureRate,
      total: violation.total,
      failures: violation.failures,
    });

    this.metrics?.increment('slaViolationsTotal', 1);

    try {
      const result = await this.submitSlash(
        violation.keeper,
        this.slashAmount,
        'keeper_sla_violation',
      );
      this.metrics?.increment('slaSlashedTotal', 1);
      this.metrics?.record('slaLastSlashAmount', Number(this.slashAmount));
      this.violationCache.set(violation.keeper, now);
      this.logger.info('Submitted keeper slashing transaction', {
        keeper: violation.keeper,
        txHash: result.txHash,
        feePaid: result.feePaid,
      });
    } catch (err) {
      this.logger.error('Failed to submit keeper slashing transaction', {
        keeper: violation.keeper,
        error: err.message,
      });
    }
  }

  async submitSlash(keeper, amount, reason) {
    const operatorPubKey = this.keypair.publicKey();
    const account = await this.server.getAccount(operatorPubKey);
    const contract = new Contract(this.contractId);
    const reasonSymbol = xdr.ScVal.scvSymbol(reason);
    const amountVal = xdr.ScVal.scvI128(xdr.Int128.fromString(String(amount)));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase || Networks.FUTURENET,
    })
      .addOperation(contract.call('slash_keeper', keeper, amountVal, reasonSymbol))
      .setTimeout(30)
      .build();

    tx.sign(this.keypair);

    const sendResult = await this.server.sendTransaction(tx);
    if (sendResult.status === 'ERROR') {
      const sendError = String(sendResult.errorResult || sendResult.error || 'Transaction submission error');
      throw new Error(`Slashing transaction failed: ${sendError}`);
    }

    const { status, feePaid } = await this.pollTransaction(sendResult.hash);
    if (status !== 'SUCCESS') {
      throw new Error(`Slashing transaction did not complete successfully: ${status}`);
    }

    return { txHash: sendResult.hash, feePaid };
  }

  async pollTransaction(txHash) {
    for (let i = 0; i < 30; i += 1) {
      const response = await this.server.getTransaction(txHash);
      if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        const feePaid = response.resultMetaXdr
          ? Number(
              response.resultMetaXdr
                ?.v3?.()
                ?.sorobanMeta?.()
                ?.ext?.()
                ?.v1?.()
                ?.totalNonRefundableResourceFeeCharged?.(),
            ) || 0
          : 0;
        return { status: 'SUCCESS', feePaid };
      }
      if (response.status === SorobanRpc.GetTransactionStatus.FAILED) {
        return { status: 'FAILED', feePaid: 0 };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { status: 'TIMEOUT', feePaid: 0 };
  }
}

module.exports = { SLAMonitor };

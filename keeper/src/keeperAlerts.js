'use strict';

/**
 * keeperAlerts.js - Real-time Slack, Discord, and PagerDuty alerting for
 * critical keeper failures (Issue #786)
 *
 * Triggers high-priority alerts when:
 * - X consecutive task executions fail
 * - RPC connection is down for more than a configurable threshold
 * - RPC calls return 5xx errors
 * - Keeper account balance drops below a configurable threshold
 * - The keeper process crashes (via an uncaught exception hook)
 *
 * All channels support rate limiting so a flapping condition doesn't spam
 * the configured webhooks.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { createLogger } = require('./logger');

const logger = createLogger('keeper-alerts');

const DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD = parseInt(
  process.env.ALERT_CONSECUTIVE_FAILURE_THRESHOLD || '3',
  10,
);
const DEFAULT_RPC_DOWN_THRESHOLD_MS = parseInt(
  process.env.ALERT_RPC_DOWN_THRESHOLD_MS || String(5 * 60 * 1000),
  10,
);
const DEFAULT_BALANCE_THRESHOLD = process.env.ALERT_BALANCE_THRESHOLD
  ? Number(process.env.ALERT_BALANCE_THRESHOLD)
  : 0;
const DEFAULT_RATE_LIMIT_MS = parseInt(
  process.env.ALERT_RATE_LIMIT_MS || String(5 * 60 * 1000),
  10,
);

function buildSlackPayload(message, details = {}, severity = 'critical') {
  return JSON.stringify({
    text: `*SoroTask Keeper Alert (${severity})*\n${message}`,
    attachments: Object.keys(details).length
      ? [
          {
            color: severity === 'critical' ? '#ff0000' : '#ffaa00',
            fields: Object.entries(details).map(([k, v]) => ({
              title: k,
              value: String(v),
              short: true,
            })),
          },
        ]
      : undefined,
  });
}

function buildDiscordPayload(message, details = {}, severity = 'critical') {
  const fields = Object.entries(details).map(([name, value]) => ({
    name,
    value: String(value),
    inline: true,
  }));
  return JSON.stringify({
    embeds: [
      {
        title: `SoroTask Keeper Alert (${severity})`,
        description: message,
        color: severity === 'critical' ? 0xff0000 : 0xffaa00,
        fields: fields.length ? fields : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

function buildPagerDutyPayload(routingKey, message, details = {}, severity = 'critical') {
  return JSON.stringify({
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: details.dedupKey || undefined,
    payload: {
      summary: message,
      severity: severity === 'critical' ? 'critical' : 'warning',
      source: 'sorotask-keeper',
      custom_details: details,
    },
  });
}

function postJson(targetUrl, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error(`Invalid webhook URL: ${targetUrl}`));
    }

    const protocol = parsed.protocol === 'https:' ? https : http;
    const data = Buffer.from(body, 'utf8');
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...extraHeaders,
      },
    };

    const req = protocol.request(options, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Webhook responded with status ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Webhook request timed out'));
    });
    req.write(data);
    req.end();
  });
}

// Kept for backwards compatibility with existing callers/tests.
const postWebhook = postJson;

function isDiscordUrl(url) {
  return url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks');
}

async function sendAlert(webhookUrl, message, details = {}, severity = 'critical') {
  if (!webhookUrl) return;
  const body = isDiscordUrl(webhookUrl)
    ? buildDiscordPayload(message, details, severity)
    : buildSlackPayload(message, details, severity);
  try {
    await postJson(webhookUrl, body);
    logger.info('Alert sent', { message, channel: isDiscordUrl(webhookUrl) ? 'discord' : 'slack' });
  } catch (err) {
    logger.error('Failed to send alert', { error: err.message, webhookUrl });
  }
}

async function sendPagerDutyAlert(routingKey, message, details = {}, severity = 'critical') {
  if (!routingKey) return;
  const body = buildPagerDutyPayload(routingKey, message, details, severity);
  try {
    await postJson('https://events.pagerduty.com/v2/enqueue', body);
    logger.info('PagerDuty alert sent', { message });
  } catch (err) {
    logger.error('Failed to send PagerDuty alert', { error: err.message });
  }
}

/**
 * KeeperAlertManager fans a single alert condition out to every configured
 * channel (Slack webhook, Discord webhook, PagerDuty routing key), and
 * rate-limits repeated alerts of the same kind so a persistent or flapping
 * failure doesn't spam the destinations.
 */
class KeeperAlertManager {
  constructor(options = {}) {
    this.slackWebhookUrl = options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL || null;
    this.discordWebhookUrl = options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || null;
    this.pagerDutyRoutingKey =
      options.pagerDutyRoutingKey || process.env.PAGERDUTY_ROUTING_KEY || null;

    // Backwards-compatible single-URL option: routed by isDiscordUrl sniffing.
    this.webhookUrl =
      options.webhookUrl ||
      process.env.ALERT_WEBHOOK_URL ||
      null;

    this.consecutiveFailureThreshold =
      options.consecutiveFailureThreshold ?? DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD;

    this.rpcDownThresholdMs =
      options.rpcDownThresholdMs ?? DEFAULT_RPC_DOWN_THRESHOLD_MS;

    this.balanceThreshold = options.balanceThreshold ?? DEFAULT_BALANCE_THRESHOLD;

    this.rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;

    this._consecutiveFailures = 0;
    this._rpcDownSince = null;
    this._rpcAlertSent = false;
    this._rpcCheckInterval = null;
    this._lastAlertAt = new Map();

    if (options.hookProcessCrashes) {
      this._installCrashHooks();
    }
  }

  /** Rate-limits alerts of a given `kind` to at most one per `rateLimitMs`. */
  _shouldSendForKind(kind) {
    const now = Date.now();
    const last = this._lastAlertAt.get(kind) || 0;
    if (now - last < this.rateLimitMs) {
      return false;
    }
    this._lastAlertAt.set(kind, now);
    return true;
  }

  async _dispatch(kind, message, details = {}, severity = 'critical') {
    if (!this._shouldSendForKind(kind)) {
      logger.info('Alert suppressed by rate limit', { kind });
      return;
    }

    const tasks = [];
    if (this.slackWebhookUrl) {
      tasks.push(sendAlert(this.slackWebhookUrl, message, details, severity));
    }
    if (this.discordWebhookUrl) {
      tasks.push(sendAlert(this.discordWebhookUrl, message, details, severity));
    }
    if (this.webhookUrl) {
      tasks.push(sendAlert(this.webhookUrl, message, details, severity));
    }
    if (this.pagerDutyRoutingKey) {
      tasks.push(
        sendPagerDutyAlert(this.pagerDutyRoutingKey, message, { dedupKey: kind, ...details }, severity),
      );
    }
    await Promise.all(tasks);
  }

  recordSuccess() {
    this._consecutiveFailures = 0;
  }

  async recordFailure(details = {}) {
    this._consecutiveFailures += 1;
    logger.warn('Task execution failure recorded', {
      consecutiveFailures: this._consecutiveFailures,
      threshold: this.consecutiveFailureThreshold,
    });

    if (this._consecutiveFailures >= this.consecutiveFailureThreshold) {
      await this._dispatch(
        'consecutive_failures',
        `${this._consecutiveFailures} consecutive task execution failures detected.`,
        { consecutiveFailures: this._consecutiveFailures, ...details },
        'critical',
      );
    }
  }

  recordRpcUp() {
    if (this._rpcDownSince !== null) {
      logger.info('RPC connection restored');
    }
    this._rpcDownSince = null;
    this._rpcAlertSent = false;
  }

  async recordRpcDown() {
    if (this._rpcDownSince === null) {
      this._rpcDownSince = Date.now();
      logger.warn('RPC connection down, monitoring for alert threshold', {
        thresholdMs: this.rpcDownThresholdMs,
      });
    }

    const downMs = Date.now() - this._rpcDownSince;
    if (!this._rpcAlertSent && downMs >= this.rpcDownThresholdMs) {
      this._rpcAlertSent = true;
      await this._dispatch(
        'rpc_down',
        `RPC connection has been down for ${Math.round(downMs / 1000)}s (threshold: ${Math.round(this.rpcDownThresholdMs / 1000)}s).`,
        { downSeconds: Math.round(downMs / 1000) },
        'critical',
      );
    }
  }

  /** Alerts on RPC responses with 5xx status codes. */
  async recordRpcError(statusCode, details = {}) {
    if (statusCode < 500 || statusCode >= 600) return;
    await this._dispatch(
      'rpc_5xx',
      `RPC returned server error ${statusCode}.`,
      { statusCode, ...details },
      'warning',
    );
  }

  /** Alerts when the keeper's on-chain account balance drops below threshold. */
  async recordBalance(balance, details = {}) {
    if (this.balanceThreshold <= 0) return;
    if (Number(balance) < this.balanceThreshold) {
      await this._dispatch(
        'low_balance',
        `Keeper account balance ${balance} is below threshold ${this.balanceThreshold}.`,
        { balance, threshold: this.balanceThreshold, ...details },
        'critical',
      );
    }
  }

  /** Alerts immediately on process crash (uncaughtException/unhandledRejection). */
  async recordCrash(error, details = {}) {
    await this._dispatch(
      'process_crash',
      `Keeper process crashed: ${error && error.message ? error.message : String(error)}`,
      { stack: error && error.stack, ...details },
      'critical',
    );
  }

  _installCrashHooks() {
    process.on('uncaughtException', (err) => {
      this.recordCrash(err).finally(() => {
        logger.error('Uncaught exception, exiting', { error: err.message });
        process.exit(1);
      });
    });
    process.on('unhandledRejection', (reason) => {
      this.recordCrash(reason instanceof Error ? reason : new Error(String(reason)));
    });
  }

  startRpcMonitor(rpcCheckFn, intervalMs = 30000) {
    this._rpcCheckInterval = setInterval(async () => {
      try {
        await rpcCheckFn();
        this.recordRpcUp();
      } catch (err) {
        await this.recordRpcDown();
        if (err && typeof err.statusCode === 'number') {
          await this.recordRpcError(err.statusCode);
        }
      }
    }, intervalMs);
  }

  stopRpcMonitor() {
    if (this._rpcCheckInterval) {
      clearInterval(this._rpcCheckInterval);
      this._rpcCheckInterval = null;
    }
  }
}

module.exports = { KeeperAlertManager, sendAlert, sendPagerDutyAlert, postWebhook };

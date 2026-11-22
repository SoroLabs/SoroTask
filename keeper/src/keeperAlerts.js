'use strict';

/**
 * keeperAlerts.js - Real-time Slack, Discord, PagerDuty, Telegram, and Email alerting
 * for critical keeper failures (Issue #786, #1449)
 *
 * Triggers high-priority alerts when:
 * - X consecutive task executions fail
 * - RPC connection is down for more than a configurable threshold
 * - RPC calls return 5xx errors
 * - Keeper account balance drops below a configurable threshold
 * - The keeper process crashes (via an uncaught exception hook)
 *
 * All channels support rate limiting and debouncing so a flapping condition doesn't spam
 * the configured webhooks. Critical alerts support exponential escalation to PagerDuty
 * if unacknowledged within a configurable window (default 5 minutes).
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
// Exponential escalation: escalate to PagerDuty if critical alert unacknowledged after this window
const DEFAULT_ESCALATION_WINDOW_MS = parseInt(
  process.env.ALERT_ESCALATION_WINDOW_MS || String(5 * 60 * 1000),
  10,
);
// Maximum escalation attempts before giving up
const DEFAULT_MAX_ESCALATION_ATTEMPTS = parseInt(
  process.env.ALERT_MAX_ESCALATION_ATTEMPTS || '3',
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

/**
 * Build an email payload for webhook-based email delivery (e.g., SendGrid, Mailgun, Postmark webhooks).
 * Expects a webhook URL that accepts JSON with: to, subject, text, html
 */
function buildEmailPayload(message, details = {}, severity = 'critical') {
  const detailLines = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join('\n');
  const subject = `[SoroTask Keeper] ${severity.toUpperCase()} Alert`;
  const text = `SoroTask Keeper Alert (${severity})\n\n${message}\n\n${detailLines}`;
  const html = `<h2>SoroTask Keeper Alert (${severity})</h2><p>${message}</p><pre>${detailLines}</pre>`;
  return JSON.stringify({ subject, text, html });
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
 * Send a Telegram alert via bot webhook (issue #1204).
 *
 * `TELEGRAM_WALLET_ALERT_WEBHOOK`-style bot webhook URLs are supported: the
 * payload is a plain Markdown text message, matching the format the
 * wallet balance monitor already uses.
 */
async function sendTelegramAlert(telegramWebhookUrl, message, details = {}, severity = 'critical') {
  if (!telegramWebhookUrl) return;
  const text =
    `*SoroTask Keeper Alert (${severity})*\n${message}\n` +
    Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  try {
    await postJson(telegramWebhookUrl, JSON.stringify({ text, parse_mode: 'Markdown' }));
    logger.info('Telegram alert sent', { message });
  } catch (err) {
    logger.error('Failed to send Telegram alert', { error: err.message });
  }
}

/**
 * Send an email alert via a webhook endpoint (e.g., SendGrid, Mailgun, Postmark, or custom relay).
 * The webhook should accept JSON with: subject, text, html (and optionally to/from).
 */
async function sendEmailAlert(emailWebhookUrl, message, details = {}, severity = 'critical') {
  if (!emailWebhookUrl) return;
  const body = buildEmailPayload(message, details, severity);
  try {
    await postJson(emailWebhookUrl, body);
    logger.info('Email alert sent', { message });
  } catch (err) {
    logger.error('Failed to send email alert', { error: err.message });
  }
}

/**
 * KeeperAlertManager fans a single alert condition out to every configured
 * channel (Slack webhook, Discord webhook, PagerDuty routing key, Telegram,
 * Email), and rate-limits repeated alerts of the same kind so a persistent
 * or flapping failure doesn't spam the destinations.
 *
 * Supports exponential escalation: if a critical alert is not acknowledged
 * within the escalation window, it re-triggers with higher urgency and
 * escalates to PagerDuty with increased severity.
 */
class KeeperAlertManager {
  constructor(options = {}) {
    this.slackWebhookUrl = options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL || null;
    this.discordWebhookUrl = options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || null;
    this.pagerDutyRoutingKey =
      options.pagerDutyRoutingKey || process.env.PAGERDUTY_ROUTING_KEY || null;
    this.telegramWebhookUrl =
      options.telegramWebhookUrl || process.env.ALERT_TELEGRAM_WEBHOOK || null;
    this.emailWebhookUrl =
      options.emailWebhookUrl || process.env.ALERT_EMAIL_WEBHOOK || null;

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

    // Exponential escalation configuration
    this.escalationWindowMs = options.escalationWindowMs ?? DEFAULT_ESCALATION_WINDOW_MS;
    this.maxEscalationAttempts = options.maxEscalationAttempts ?? DEFAULT_MAX_ESCALATION_ATTEMPTS;

    this._consecutiveFailures = 0;
    this._rpcDownSince = null;
    this._rpcAlertSent = false;
    this._rpcCheckInterval = null;
    this._lastAlertAt = new Map();
    // Track active alerts for escalation: kind -> { sentAt, attempts, severity, acknowledged }
    this._activeAlerts = new Map();
    this._escalationCheckInterval = null;

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
    if (this.telegramWebhookUrl) {
      tasks.push(sendTelegramAlert(this.telegramWebhookUrl, message, details, severity));
    }
    if (this.emailWebhookUrl) {
      tasks.push(sendEmailAlert(this.emailWebhookUrl, message, details, severity));
    }
    await Promise.all(tasks);

    // Track critical alerts for exponential escalation
    if (severity === 'critical' && this.pagerDutyRoutingKey) {
      this._activeAlerts.set(kind, {
        sentAt: Date.now(),
        attempts: 1,
        severity,
        message,
        details,
        acknowledged: false,
      });
      this._startEscalationMonitor();
    }
  }

  /**
   * Start the escalation monitor if not already running.
   * Checks active alerts periodically and escalates unacknowledged ones.
   */
  _startEscalationMonitor() {
    if (this._escalationCheckInterval) return;
    this._escalationCheckInterval = setInterval(() => this._checkEscalations(), 60000); // Check every minute
  }

  /**
   * Check active alerts and escalate any unacknowledged critical alerts
   * that have exceeded the escalation window.
   */
  async _checkEscalations() {
    const now = Date.now();
    for (const [kind, alert] of this._activeAlerts.entries()) {
      if (alert.acknowledged) {
        this._activeAlerts.delete(kind);
        continue;
      }
      const elapsed = now - alert.sentAt;
      if (elapsed >= this.escalationWindowMs && alert.attempts < this.maxEscalationAttempts) {
        // Escalate: resend to PagerDuty with increased urgency
        const escalatedSeverity = alert.attempts >= this.maxEscalationAttempts - 1 ? 'critical' : 'warning';
        const escalatedMessage = `[ESCALATION ${alert.attempts + 1}/${this.maxEscalationAttempts}] ${alert.message}`;
        logger.warn('Escalating unacknowledged alert', { kind, attempt: alert.attempts + 1, elapsedMs: elapsed });
        try {
          await sendPagerDutyAlert(
            this.pagerDutyRoutingKey,
            escalatedMessage,
            { dedupKey: kind, ...alert.details, escalationAttempt: alert.attempts + 1 },
            escalatedSeverity,
          );
          // Also re-notify other channels for visibility
          await this._dispatch(kind, escalatedMessage, { ...alert.details, escalationAttempt: alert.attempts + 1 }, escalatedSeverity);
        } catch (err) {
          logger.error('Escalation failed', { kind, error: err.message });
        }
        alert.attempts += 1;
        alert.sentAt = now; // Reset timer for next escalation window
      } else if (alert.attempts >= this.maxEscalationAttempts) {
        logger.error('Max escalation attempts reached, alert unacknowledged', { kind });
        this._activeAlerts.delete(kind);
      }
    }
    // Clean up if no more active alerts
    if (this._activeAlerts.size === 0 && this._escalationCheckInterval) {
      clearInterval(this._escalationCheckInterval);
      this._escalationCheckInterval = null;
    }
  }

  /**
   * Acknowledge an alert by kind, stopping further escalation.
   * Can be called by external systems (e.g., PagerDuty webhook handler).
   */
  acknowledgeAlert(kind) {
    const alert = this._activeAlerts.get(kind);
    if (alert) {
      alert.acknowledged = true;
      logger.info('Alert acknowledged, escalation stopped', { kind });
      return true;
    }
    return false;
  }

  /**
   * Fan a one-off alert out to every configured channel (rate-limited by
   * `kind`). Used by callers such as the dead-letter quarantine engine to
   * reuse the same fan-out and rate limiting as the built-in conditions.
   */
  async notify(kind, message, details = {}, severity = 'critical') {
    return this._dispatch(kind, message, details, severity);
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

module.exports = {
  KeeperAlertManager,
  sendAlert,
  sendPagerDutyAlert,
  sendTelegramAlert,
  sendEmailAlert,
  buildEmailPayload,
  postWebhook,
};

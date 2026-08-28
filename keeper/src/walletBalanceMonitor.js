'use strict';

/**
 * walletBalanceMonitor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #1063 — Wallet Balance Low-Threshold Monitor & Auto-Refill Sweep Alerts
 *
 * Monitors the keeper account's native XLM balance at a configurable interval
 * (default 60 seconds). When balance drops below WARNING_THRESHOLD, multi-channel
 * alerts fire (PagerDuty, Discord, Telegram). When balance drops below
 * CRITICAL_THRESHOLD, an automated balance sweep is triggered from a designated
 * funding cold wallet.
 *
 * Configuration:
 *   WALLET_BALANCE_CHECK_INTERVAL_MS  - Check interval (default: 60000)
 *   WALLET_WARNING_THRESHOLD_XLM      - Warning alert threshold (default: 50)
 *   WALLET_CRITICAL_THRESHOLD_XLM     - Critical auto-sweep threshold (default: 20)
 *   WALLET_SWEEP_ENABLED              - Enable auto-sweep (default: false)
 *   WALLET_SWEEP_FUNDING_SECRET       - Funding wallet secret key (for sweep)
 *   WALLET_SWEEP_FUNDING_PUBLIC       - Funding wallet public key
 *   WALLET_SWEEP_TARGET_AMOUNT_XLM    - Amount to sweep (default: 100)
 *   PAGERDUTY_ALERT_KEY               - PagerDuty integration key
 *   DISCORD_WALLET_ALERT_WEBHOOK      - Discord webhook URL
 *   TELEGRAM_WALLET_ALERT_WEBHOOK     - Telegram bot webhook URL
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { createLogger } = require('./logger');
const { sendAlert } = require('./keeperAlerts');

const logger = createLogger('wallet-balance-monitor');

const WARNING_THRESHOLD_DEFAULT = 50;
const CRITICAL_THRESHOLD_DEFAULT = 20;
const CHECK_INTERVAL_MS_DEFAULT = 60000;
const SWEEP_TARGET_AMOUNT_XLM_DEFAULT = 100;

/**
 * WalletBalanceMonitor
 *
 * Periodically checks the keeper's XLM balance and dispatches alerts/sweeps
 * when configured thresholds are crossed.
 */
class WalletBalanceMonitor {
  /**
   * @param {object} options
   * @param {import('@stellar/stellar-sdk').rpc.Server} options.server - Soroban RPC server
   * @param {string} options.publicKey - Keeper's Stellar public key
   * @param {Function} [options.getBalanceFn] - Custom balance fetcher (for testing)
   * @param {Function} [options.sendAlertFn] - Custom alert sender (for testing)
   * @param {Function} [options.sweepFn] - Custom sweep executor (for testing)
   */
  constructor(options = {}) {
    this.server = options.server;
    this.publicKey = options.publicKey;
    this.getBalanceFn = options.getBalanceFn || this._fetchBalance.bind(this);
    this.sendAlertFn = options.sendAlertFn || this._dispatchAlert.bind(this);
    this.sweepFn = options.sweepFn || this._executeSweep.bind(this);

    this.warningThreshold = parseFloat(process.env.WALLET_WARNING_THRESHOLD_XLM) || WARNING_THRESHOLD_DEFAULT;
    this.criticalThreshold = parseFloat(process.env.WALLET_CRITICAL_THRESHOLD_XLM) || CRITICAL_THRESHOLD_DEFAULT;
    this.checkIntervalMs = parseInt(process.env.WALLET_BALANCE_CHECK_INTERVAL_MS, 10) || CHECK_INTERVAL_MS_DEFAULT;
    this.sweepEnabled = ['1', 'true', 'yes'].includes((process.env.WALLET_SWEEP_ENABLED || '').toLowerCase());
    this.sweepTargetAmount = parseFloat(process.env.WALLET_SWEEP_TARGET_AMOUNT_XLM) || SWEEP_TARGET_AMOUNT_XLM_DEFAULT;
    this.fundingSecret = process.env.WALLET_SWEEP_FUNDING_SECRET || '';
    this.fundingPublicKey = process.env.WALLET_SWEEP_FUNDING_PUBLIC || '';

    // Alert channels
    this.pagerdutyKey = process.env.PAGERDUTY_ALERT_KEY || '';
    this.discordWebhook = process.env.DISCORD_WALLET_ALERT_WEBHOOK || '';
    this.telegramWebhook = process.env.TELEGRAM_WALLET_ALERT_WEBHOOK || '';

    this._intervalHandle = null;
    this._lastBalance = null;
    this._lastAlertTimestamp = 0;
    this._alertDebounceMs = parseInt(process.env.WALLET_ALERT_DEBOUNCE_MS, 10) || 300000;
    this._sweepInProgress = false;
  }

  /**
   * Start the periodic balance monitoring loop.
   */
  start() {
    if (this._intervalHandle) {
      logger.warn('WalletBalanceMonitor already running');
      return;
    }

    logger.info('Starting WalletBalanceMonitor', {
      checkIntervalMs: this.checkIntervalMs,
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
      sweepEnabled: this.sweepEnabled,
    });

    // Run an initial check immediately
    this._checkBalance();

    this._intervalHandle = setInterval(() => {
      this._checkBalance();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the monitoring loop.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
      logger.info('WalletBalanceMonitor stopped');
    }
  }

  /**
   * Get the current cached balance.
   * @returns {number|null}
   */
  getLastBalance() {
    return this._lastBalance;
  }

  /**
   * Get monitor configuration status.
   */
  getStatus() {
    return {
      running: this._intervalHandle !== null,
      lastBalance: this._lastBalance,
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
      checkIntervalMs: this.checkIntervalMs,
      sweepEnabled: this.sweepEnabled,
      sweepTargetAmount: this.sweepTargetAmount,
      channels: {
        pagerduty: !!this.pagerdutyKey,
        discord: !!this.discordWebhook,
        telegram: !!this.telegramWebhook,
      },
    };
  }

  /**
   * Perform a single balance check. Public for manual/on-demand invocation.
   * @returns {Promise<{ balance: number, level: 'ok'|'warning'|'critical', sweepTriggered: boolean }>}
   */
  async checkNow() {
    return this._checkBalance();
  }

  /**
   * Internal balance check loop iteration.
   * @private
   */
  async _checkBalance() {
    try {
      const balance = await this.getBalanceFn(this.publicKey, this.server);
      this._lastBalance = balance;

      if (balance < this.criticalThreshold) {
        logger.warn('CRITICAL: XLM balance below critical threshold', {
          balance,
          threshold: this.criticalThreshold,
        });

        // Fire critical alert
        await this.sendAlertFn('critical', {
          balance,
          threshold: this.criticalThreshold,
          type: 'WALLET_CRITICAL',
          message: `Keeper XLM balance critically low: ${balance} XLM (threshold: ${this.criticalThreshold} XLM)`,
        });

        // Trigger auto-sweep if enabled
        if (this.sweepEnabled && !this._sweepInProgress) {
          await this._triggerAutoSweep(balance);
        }

        return { balance, level: 'critical', sweepTriggered: this._sweepInProgress };
      }

      if (balance < this.warningThreshold) {
        logger.warn('WARNING: XLM balance below warning threshold', {
          balance,
          threshold: this.warningThreshold,
        });

        await this.sendAlertFn('warning', {
          balance,
          threshold: this.warningThreshold,
          type: 'WALLET_WARNING',
          message: `Keeper XLM balance low: ${balance} XLM (threshold: ${this.warningThreshold} XLM)`,
        });

        return { balance, level: 'warning', sweepTriggered: false };
      }

      logger.debug('XLM balance sufficient', { balance });
      return { balance, level: 'ok', sweepTriggered: false };
    } catch (err) {
      logger.error('Failed to check wallet balance', { error: err.message });
      return { balance: null, level: 'unknown', sweepTriggered: false };
    }
  }

  /**
   * Dispatch alerts to all configured channels (PagerDuty, Discord, Telegram).
   * Alerts are debounced to prevent spam.
   * @param {'warning'|'critical'} level
   * @param {object} details
   * @private
   */
  async _dispatchAlert(level, details) {
    const now = Date.now();
    if (now - this._lastAlertTimestamp < this._alertDebounceMs) {
      logger.debug('Alert debounced, skipping', { level });
      return;
    }
    this._lastAlertTimestamp = now;

    const promises = [];

    // PagerDuty (via Events API v2)
    if (this.pagerdutyKey) {
      promises.push(this._sendPagerDutyAlert(level, details));
    }

    // Discord
    if (this.discordWebhook) {
      promises.push(sendAlert(this.discordWebhook, details.message, details));
    }

    // Telegram
    if (this.telegramWebhook) {
      promises.push(this._sendTelegramAlert(details));
    }

    if (promises.length === 0) {
      logger.warn('No alert channels configured for wallet balance alerts');
      return;
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send a PagerDuty alert via Events API v2.
   * @param {'warning'|'critical'} severity
   * @param {object} details
   * @private
   */
  async _sendPagerDutyAlert(severity, details) {
    try {
      const fetchFn = globalThis.fetch || require('node-fetch');
      const pdSeverity = severity === 'critical' ? 'critical' : 'warning';
      await fetchFn('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: this.pagerdutyKey,
          event_action: 'trigger',
          payload: {
            summary: details.message,
            severity: pdSeverity,
            source: 'sorotask-keeper',
            component: 'wallet-balance',
            group: 'keeper-wallet',
            class: 'balance-monitor',
            custom_details: details,
          },
        }),
      });
      logger.info('PagerDuty alert sent', { severity });
    } catch (err) {
      logger.error('PagerDuty alert failed', { error: err.message });
    }
  }

  /**
   * Send a Telegram alert via bot webhook.
   * @param {object} details
   * @private
   */
  async _sendTelegramAlert(details) {
    try {
      const fetchFn = globalThis.fetch || require('node-fetch');
      const text = `🚨 *SoroTask Keeper Alert*\n\n${details.message}\n\nBalance: ${details.balance} XLM\nThreshold: ${details.threshold} XLM`;
      await fetchFn(this.telegramWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          parse_mode: 'Markdown',
        }),
      });
      logger.info('Telegram alert sent');
    } catch (err) {
      logger.error('Telegram alert failed', { error: err.message });
    }
  }

  /**
   * Trigger an automated XLM sweep from the funding wallet.
   * @param {number} currentBalance
   * @private
   */
  async _triggerAutoSweep(currentBalance) {
    if (!this.fundingSecret || !this.fundingPublicKey) {
      logger.error('Auto-sweep triggered but WALLET_SWEEP_FUNDING_SECRET/PUBLIC not configured');
      return;
    }

    this._sweepInProgress = true;
    logger.info('Initiating auto-sweep from funding wallet', {
      currentBalance,
      targetAmount: this.sweepTargetAmount,
    });

    try {
      const result = await this.sweepFn({
        server: this.server,
        fundingSecret: this.fundingSecret,
        fundingPublicKey: this.fundingPublicKey,
        targetPublicKey: this.publicKey,
        amount: this.sweepTargetAmount,
      });

      logger.info('Auto-sweep completed', { result });
      await this.sendAlertFn('info', {
        type: 'WALLET_SWEEP_COMPLETED',
        message: `Auto-sweep completed: ${this.sweepTargetAmount} XLM transferred from funding wallet`,
        sweepResult: result,
      });
    } catch (err) {
      logger.error('Auto-sweep failed', { error: err.message });
      await this.sendAlertFn('error', {
        type: 'WALLET_SWEEP_FAILED',
        message: `Auto-sweep failed: ${err.message}`,
      });
    } finally {
      this._sweepInProgress = false;
    }
  }

  /**
   * Execute a payment from the funding wallet to the keeper.
   * Uses Stellar SDK to build, sign, and submit a payment transaction.
   *
   * @param {object} params
   * @param {import('@stellar/stellar-sdk').rpc.Server} params.server
   * @param {string} params.fundingSecret
   * @param {string} params.fundingPublicKey
   * @param {string} params.targetPublicKey
   * @param {number} params.amount
   * @returns {Promise<{ txHash: string, status: string }>}
   * @private
   */
  async _executeSweep({ server, fundingSecret, fundingPublicKey, targetPublicKey, amount }) {
    const { Keypair, TransactionBuilder, Networks, Account, Asset } = require('@stellar/stellar-sdk');

    const fundingKeypair = Keypair.fromSecret(fundingSecret);
    const fundingAccount = await server.getAccount(fundingPublicKey);

    const account = new Account(fundingAccount.accountId(), fundingAccount.sequenceNumber());
    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET,
    })
      .addOperation({
        type: 'payment',
        destination: targetPublicKey,
        asset: Asset.native(),
        amount: String(Math.ceil(amount)),
      })
      .setTimeout(30)
      .build();

    tx.sign(fundingKeypair);
    const result = await server.sendTransaction(tx);

    if (result.status === 'ERROR') {
      throw new Error(`Sweep transaction failed: ${result.error || result.errorResult}`);
    }

    return { txHash: result.hash, status: result.status };
  }

  /**
   * Fetch the native XLM balance for a public key.
   * @param {string} publicKey
   * @param {import('@stellar/stellar-sdk').rpc.Server} server
   * @returns {Promise<number>}
   * @private
   */
  async _fetchBalance(publicKey, server) {
    const accountResponse = await server.getAccount(publicKey);
    const balances = accountResponse.balances || [];
    const nativeBalance = balances.find((b) => b.asset_type === 'native');
    return nativeBalance ? parseFloat(nativeBalance.balance) : 0;
  }
}

module.exports = { WalletBalanceMonitor };

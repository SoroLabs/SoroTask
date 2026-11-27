const { BASE_FEE, TransactionBuilder } = require('@stellar/stellar-sdk');

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_TRANSACTIONS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_JSON_RPC_METHOD = 'getPendingTransactions';

function extractTransactions(payload) {
  const result = payload && payload.result;
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return null;
  for (const key of ['transactions', 'pending', 'txs']) {
    if (Array.isArray(result[key])) return result[key];
  }
  return null;
}

function asPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

class StellarMempoolClient {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.STELLAR_MEMPOOL_RPC_URL || null;
    this.method = options.method || process.env.STELLAR_MEMPOOL_RPC_METHOD || DEFAULT_JSON_RPC_METHOD;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.maxTransactions = Math.max(1, Number(options.maxTransactions) || DEFAULT_MAX_TRANSACTIONS);
    this.maxResponseBytes = Math.max(1024, Number(options.maxResponseBytes) || DEFAULT_MAX_RESPONSE_BYTES);
    this.requestId = 0;
    this.subscribe = options.subscribe || null;
  }

  subscribePendingTransactions(listener) {
    if (!this.subscribe) return null;
    return this.subscribe(listener);
  }

  async getPendingTransactions() {
    if (!this.rpcUrl) {
      throw new Error('Mempool RPC URL is not configured; set STELLAR_MEMPOOL_RPC_URL.');
    }
    if (typeof this.fetch !== 'function') {
      throw new Error('Mempool RPC fetch implementation is unavailable.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: this.method,
          params: [],
        }),
        signal: controller.signal,
      });
      if (!response || !response.ok) {
        throw new Error(`Mempool RPC returned HTTP ${response ? response.status : 'no response'}.`);
      }

      const contentLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
        throw new Error(`Mempool RPC response exceeds ${this.maxResponseBytes} bytes.`);
      }
      const payload = await response.json();
      if (payload?.error) {
        const message = payload.error.message || JSON.stringify(payload.error);
        throw new Error(`Mempool RPC method "${this.method}" failed: ${message}`);
      }

      const transactions = extractTransactions(payload);
      if (!Array.isArray(transactions)) {
        throw new Error(`Mempool RPC method "${this.method}" returned no supported pending-transaction list.`);
      }
      return transactions.slice(0, this.maxTransactions);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Mempool RPC request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class FeeBumpProtection {
  constructor(options = {}) {
    this.sniffer = options.sniffer;
    this.feeSource = options.feeSource || null;
    this.signer = options.signer || null;
    this.networkPassphrase = options.networkPassphrase || null;
    this.maxFeeStroops = asPositiveInteger(options.maxFeeStroops);
    this.minProfitStroops = Math.max(0, Number(options.minProfitStroops) || 0);
    this.minBumpMultiplier = Math.max(10, Number(options.minBumpMultiplier) || 10);
    this.maxBumpMultiplier = Math.max(this.minBumpMultiplier, Number(options.maxBumpMultiplier) || 100);
    this.logger = options.logger || console;
  }

  async protect(transaction, options = {}) {
    if (!this.sniffer || !this.feeSource || !this.networkPassphrase) {
      return { transaction, bumped: false, reason: 'fee-bump-not-configured' };
    }
    const source = typeof this.feeSource.publicKey === 'function'
      ? this.feeSource.publicKey()
      : String(this.feeSource);
    const transactionSource = transaction.source || transaction.sourceAccount || transaction.source_account;
    if (String(transactionSource || '') !== source) {
      throw new Error('Fee-bump protection only accepts a transaction signed by the configured keeper account.');
    }

    const bountyStroops = asPositiveInteger(options.bountyStroops);
    if (!bountyStroops) {
      return { transaction, bumped: false, reason: 'bounty-unavailable' };
    }
    const configuredMax = this.maxFeeStroops || asPositiveInteger(options.maxFeeStroops);
    if (!configuredMax) {
      return { transaction, bumped: false, reason: 'fee-cap-unconfigured' };
    }
    const affordableCap = Math.min(configuredMax, bountyStroops - this.minProfitStroops);
    if (affordableCap <= 0) {
      return { transaction, bumped: false, reason: 'profitability-cap-exceeded' };
    }

    try {
      const lastSuccessAt = this.sniffer.metrics?.lastSuccessAt;
      const refreshInterval = Number(this.sniffer.intervalMs) || 0;
      if (!lastSuccessAt || Date.now() - lastSuccessAt >= refreshInterval) {
        await this.sniffer.scanOnce();
      }
    } catch (error) {
      this._warn('Unable to inspect mempool before submission; submitting the signed transaction unchanged.', error);
      return { transaction, bumped: false, reason: 'mempool-unavailable', error };
    }
    const conflicts = this.sniffer.findConflicts(transaction, {
      contractId: options.contractId,
      taskId: options.taskId,
    });
    if (conflicts.length === 0) {
      return { transaction, bumped: false, reason: 'no-sequence-conflict' };
    }

    const innerFee = asPositiveInteger(transaction.fee);
    if (!innerFee) {
      throw new Error('Cannot fee-bump transaction with an invalid inner fee.');
    }
    const envelope = transaction.toEnvelope();
    const txEnvelope = envelope?.value?.tx;
    const extension = txEnvelope?.ext;
    const resourceFee = extension?.type === 'sorobanData'
      ? asPositiveInteger(extension.value?.resourceFee?.toString()) || 0
      : 0;
    const operationCount = Math.max(1, transaction.operations?.length || 1);
    const inclusionFee = Math.max(1, Math.ceil((innerFee - resourceFee) / operationCount));
    const candidateFees = conflicts
      .map((candidate) => asPositiveInteger(candidate.fee ?? candidate.fee_charged ?? candidate.max_fee))
      .filter(Boolean);
    const highestConflictFee = candidateFees.length
      ? Math.ceil(Math.max(...candidateFees) / operationCount)
      : 0;
    const bumpCap = Math.floor(inclusionFee * this.maxBumpMultiplier);
    const targetBaseFee = Math.min(
      bumpCap,
      Math.max(
        Number(BASE_FEE) * this.minBumpMultiplier,
        Math.ceil(inclusionFee * this.minBumpMultiplier),
        highestConflictFee + 1,
      ),
    );
    if (targetBaseFee <= inclusionFee) {
      return { transaction, bumped: false, reason: 'fee-cap-below-minimum-bump' };
    }

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.feeSource,
      String(targetBaseFee),
      transaction,
      this.networkPassphrase,
    );
    const outerFee = asPositiveInteger(feeBump.fee);
    if (!outerFee || outerFee > affordableCap) {
      return {
        transaction,
        bumped: false,
        reason: 'profitability-cap-exceeded',
        requiredFeeStroops: outerFee,
        maxFeeStroops: affordableCap,
      };
    }

    if (this.signer && typeof this.signer.signTransaction === 'function') {
      await this.signer.signTransaction(feeBump);
    } else if (typeof this.feeSource.sign === 'function') {
      feeBump.sign(this.feeSource);
    } else {
      throw new Error('Fee-bump transaction requires a configured local or HSM signer.');
    }

    return {
      transaction: feeBump,
      bumped: true,
      reason: 'competing-keeper-task-or-sequence-transaction',
      conflicts: conflicts.length,
      baseFeeStroops: targetBaseFee,
      totalFeeStroops: outerFee,
    };
  }

  _warn(message, error) {
    if (typeof this.logger?.warn !== 'function') return;
    if (this.logger.warn.length >= 2) {
      this.logger.warn({ error: error.message }, message);
    } else {
      this.logger.warn(`${message} ${error.message}`);
    }
  }
}

module.exports = {
  StellarMempoolClient,
  FeeBumpProtection,
  extractTransactions,
};

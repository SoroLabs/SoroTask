'use strict';

const {
  Contract,
  xdr,
  Address,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc: SorobanRpc,
} = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

/**
 * gasVaultRefill.js - automated gas vault refill via a Soroban swap router
 * (Issue #787).
 *
 * # The failure
 *
 * A keeper's signing account holds native XLM to pay transaction fees.
 * When task bounties are paid out in a stablecoin or custom token instead
 * of XLM, the keeper's fee reserve only ever drains and never
 * replenishes - it eventually runs out of gas even while sitting on a
 * healthy stablecoin balance it could have converted.
 *
 * # What this does
 *
 * `GasVaultRefillMonitor` periodically checks the keeper's XLM balance
 * (via an injected `getXlmBalance`) against `triggerThresholdXlm`. When
 * below it, it checks each configured source asset (via
 * `getSourceAssetBalance`, in priority order) for enough balance to swap,
 * and calls a Soroswap-router-compatible contract's
 * `swap_exact_tokens_for_tokens` to convert it to XLM, up to roughly
 * `targetBalanceXlm`.
 *
 * # Why balances are injected, not fetched directly here
 *
 * Reading a classic Stellar asset trustline balance requires either
 * Horizon or parsing the account's ledger entry XDR directly - neither is
 * a fixed, one-size-fits-all choice across every SoroTask deployment (some
 * run Horizon alongside Soroban RPC, some don't). Rather than hard-code
 * one and risk it not matching a given RPC endpoint's actual response
 * shape, both balance getters are required constructor options - wire in
 * whatever your deployment's account-balance source actually is.
 */

const DEFAULT_CHECK_INTERVAL_MS = 60000;
const DEFAULT_COOLDOWN_MS = 600000;
const STROOPS_PER_XLM = 10_000_000;

/**
 * TreasuryRefillChannel — automated treasury top-up over a multisig signing
 * channel (issue #1215).
 *
 * When the swap-based refill path has no usable source balance, the keeper
 * submits a refill REQUEST to the treasury contract instead of silently
 * starving. Configuration (all optional; the channel stays a no-op until
 * configured):
 *
 *   TREASURY_CONTRACT_ID             - Treasury (multisig-governed) contract ID
 *   TREASURY_REFILL_FUNCTION         - Contract fn to invoke (default: request_refill)
 *   TREASURY_REFILL_TARGET           - Refill recipient (default: keeper's own key)
 *   TREASURY_REFILL_SIGNER_SECRETS   - Comma-separated signer secret keys
 *   TREASURY_REFILL_MIN_SIGNATURES   - Quorum required to submit (default: all)
 *
 * The request is a Soroban contract invocation signed by a quorum of the
 * configured signers — Soroban multi-sig transactions carry every signer's
 * auth entry, so the treasury's K-of-N threshold can accept the refill.
 */
class TreasuryRefillChannel {
  /**
   * @param {object} options
   * @param {SorobanRpc.Server} options.server
   * @param {string} options.keeperPublicKey
   * @param {string[]} [options.signerSecrets]
   * @param {number} [options.minSignatures]
   * @param {string} [options.treasuryContractId]
   * @param {string} [options.refillFunction]
   * @param {string} [options.networkPassphrase]
   * @param {object} [options.logger]
   * @param {object} [options.metrics] - Optional `{ increment(key) }`.
   */
  constructor(options = {}) {
    this.server = options.server;
    this.keeperPublicKey = options.keeperPublicKey;
    this.signerSecrets = options.signerSecrets || [];
    this.minSignatures = options.minSignatures ?? this.signerSecrets.length;
    this.treasuryContractId = options.treasuryContractId || null;
    this.refillFunction = options.refillFunction || 'request_refill';
    this.networkPassphrase = options.networkPassphrase || Networks.FUTURENET;
    this.logger = options.logger || createLogger('treasury-refill');
    this.metrics = options.metrics || null;
  }

  static fromEnv(server, keeperPublicKey, logger) {
    const signerSecrets = (process.env.TREASURY_REFILL_SIGNER_SECRETS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const minSignatures = parseInt(process.env.TREASURY_REFILL_MIN_SIGNATURES, 10) || signerSecrets.length;

    return new TreasuryRefillChannel({
      server,
      keeperPublicKey,
      signerSecrets,
      minSignatures,
      treasuryContractId: process.env.TREASURY_CONTRACT_ID || null,
      refillFunction: process.env.TREASURY_REFILL_FUNCTION || 'request_refill',
      networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET,
      logger,
    });
  }

  get isConfigured() {
    return Boolean(
      this.treasuryContractId && this.signerSecrets.length > 0 && this.minSignatures > 0,
    );
  }

  /**
   * Submit an automated top-up request to the treasury contract.
   *
   * @param {object} params
   * @param {number} params.amountXlm - Refill amount in XLM.
   * @param {string} [params.reason] - Free-form reason recorded in the request.
   * @returns {Promise<{ requested: boolean, reason?: string, txHash?: string }>}
   */
  async requestTopUp({ amountXlm, reason = 'keeper_gas_low' } = {}) {
    if (!this.isConfigured) {
      return { requested: false, reason: 'not_configured' };
    }

    if (this.signerSecrets.length < this.minSignatures) {
      return { requested: false, reason: 'insufficient_signers' };
    }

    return this._submit({ amountXlm, reason });
  }

  /**
   * Builds the refill invocation, signs it with a quorum of the configured
   * signers, and submits it. Injectable-free by design: tests stub this
   * method the same way they stub `GasVaultRefillMonitor._executeSwap`.
   * @private
   */
  async _submit({ amountXlm, reason }) {
    const { Keypair, TransactionBuilder, Account } = require('@stellar/stellar-sdk');

    const signers = this.signerSecrets.slice(0, Math.max(this.minSignatures, 1))
      .map((secret) => Keypair.fromSecret(secret));
    const payer = signers[0];

    const account = await this.server.getAccount(payer.publicKey());
    const treasury = new Contract(this.treasuryContractId);

    const amountStroops = BigInt(Math.floor(amountXlm * STROOPS_PER_XLM));
    const tx = new TransactionBuilder(new Account(account.accountId(), account.sequenceNumber()), {
      fee: (Number(BASE_FEE) * signers.length).toString(),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        treasury.call(
          this.refillFunction,
          Address.fromString(this.keeperPublicKey).toScVal(),
          xdr.ScVal.scvI128(xdr.Int128.fromString(amountStroops.toString())),
          xdr.ScVal.scvString(reason),
        ),
      )
      .setTimeout(60)
      .build();

    // Multisig channel: every quorum signer authorizes the same transaction.
    for (const signer of signers) {
      tx.sign(signer);
    }

    const sendResult = await this.server.sendTransaction(tx);
    if (sendResult.status === 'ERROR') {
      throw new Error(`Treasury refill request failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    this.metrics?.increment?.('treasuryRefillRequestTotal');
    this.logger.info('Treasury refill request submitted', {
      txHash: sendResult.hash,
      amountXlm,
      signers: signers.length,
      reason,
    });

    return { requested: true, txHash: sendResult.hash, signers: signers.length };
  }
}

class GasVaultRefillMonitor {
  /**
   * @param {object} options
   * @param {SorobanRpc.Server} options.server
   * @param {import('@stellar/stellar-sdk').Keypair} options.keypair - Keeper signing keypair.
   * @param {() => Promise<number>} options.getXlmBalance - Resolves the keeper's current native XLM balance.
   * @param {(assetContractId: string) => Promise<number>} options.getSourceAssetBalance
   *   Resolves the keeper's balance of a given source asset, in that asset's own units.
   * @param {number} [options.triggerThresholdXlm]
   * @param {number} [options.targetBalanceXlm]
   * @param {string} options.routerContractId - Soroswap-compatible router contract ID.
   * @param {string[]} options.sourceAssetContractIds - Source asset SAC contract IDs, priority order.
   * @param {string} options.xlmContractId - Native XLM SAC contract ID.
   * @param {number} [options.maxSlippage] - Fraction, e.g. 0.01 = 1%.
   * @param {number} [options.cooldownMs]
   * @param {number} [options.checkIntervalMs]
   * @param {string} [options.networkPassphrase]
   * @param {object} [options.metrics] - Optional `{ increment(key) }`.
   * @param {TreasuryRefillChannel} [options.treasuryChannel] - Multisig
   *   treasury top-up fallback used when no source asset can be swapped
   *   (issue #1215).
   * @param {TreasuryRefillChannel} [options.treasuryChannel] - Multisig
   *   treasury top-up fallback used when no source asset can be swapped
   *   (issue #1215).
   */
  constructor(options = {}) {
    this.server = options.server;
    this.keypair = options.keypair;
    this.getXlmBalance = options.getXlmBalance;
    this.getSourceAssetBalance = options.getSourceAssetBalance;
    this.triggerThresholdXlm = options.triggerThresholdXlm ?? 30;
    this.targetBalanceXlm = options.targetBalanceXlm ?? 100;
    this.routerContractId = options.routerContractId;
    this.sourceAssetContractIds = options.sourceAssetContractIds || [];
    this.xlmContractId = options.xlmContractId;
    this.maxSlippage = options.maxSlippage ?? 0.01;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.networkPassphrase = options.networkPassphrase || Networks.FUTURENET;
    this.logger = options.logger || createLogger('gas-vault-refill');
    this.metrics = options.metrics || null;

    this.treasuryChannel = options.treasuryChannel || null;
    this._intervalHandle = null;
    this._lastSwapAt = 0;
    this._swapInProgress = false;
  }

  start() {
    if (this._intervalHandle) return;
    this._intervalHandle = setInterval(() => {
      this.checkAndRefill().catch((error) => {
        this.logger.error('Gas vault refill check failed', { error: error.message });
      });
    }, this.checkIntervalMs);
    this.logger.info('Gas vault refill monitor started', {
      triggerThresholdXlm: this.triggerThresholdXlm,
      targetBalanceXlm: this.targetBalanceXlm,
      sourceAssets: this.sourceAssetContractIds.length,
    });
  }

  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  /**
   * Run one check-and-refill pass. Safe to call directly (e.g. from tests
   * or an admin endpoint) without `start()`.
   *
   * @returns {Promise<{triggered: boolean, reason?: string, swapped?: object}>}
   */
  async checkAndRefill() {
    if (this._swapInProgress) {
      return { triggered: false, reason: 'swap_in_progress' };
    }
    if (Date.now() - this._lastSwapAt < this.cooldownMs) {
      return { triggered: false, reason: 'cooldown' };
    }
    if (!this.routerContractId || !this.xlmContractId || this.sourceAssetContractIds.length === 0) {
      return { triggered: false, reason: 'not_configured' };
    }

    const xlmBalance = await this.getXlmBalance();
    if (xlmBalance >= this.triggerThresholdXlm) {
      return { triggered: false, reason: 'above_threshold', xlmBalance };
    }

    this.logger.warn('XLM balance below refill threshold, attempting swap', {
      xlmBalance,
      triggerThresholdXlm: this.triggerThresholdXlm,
    });

    for (const sourceAssetContractId of this.sourceAssetContractIds) {
      const sourceBalance = await this.getSourceAssetBalance(sourceAssetContractId);
      if (sourceBalance <= 0) continue;

      this._swapInProgress = true;
      try {
        const shortfallXlm = this.targetBalanceXlm - xlmBalance;
        const swapResult = await this._executeSwap({
          sourceAssetContractId,
          sourceBalance,
          targetXlmAmount: shortfallXlm,
        });
        this._lastSwapAt = Date.now();
        this.metrics?.increment?.('gasVaultRefillSwapSucceededTotal');
        this.logger.info('Gas vault refill swap submitted', {
          sourceAssetContractId,
          txHash: swapResult.txHash,
        });
        return { triggered: true, swapped: swapResult };
      } catch (error) {
        this.metrics?.increment?.('gasVaultRefillSwapFailedTotal');
        this.logger.error('Gas vault refill swap failed', {
          sourceAssetContractId,
          error: error.message,
        });
        // Try the next configured source asset rather than giving up entirely.
      } finally {
        this._swapInProgress = false;
      }
    }

    const treasuryFallback = await this.requestTreasuryTopUp(xlmBalance);
    if (treasuryFallback.triggered) {
      return { triggered: true, reason: 'treasury_refill_requested', treasury: treasuryFallback.treasury };
    }

    return {
      triggered: false,
      reason: treasuryFallback.reason === 'treasury_not_configured'
        ? 'no_usable_source_balance'
        : treasuryFallback.reason,
      xlmBalance,
    };
  }

  /**
   * Automated treasury top-up fallback (issue #1215): when no source asset
   * can be swapped for XLM, submit a refill request to the configured
   * treasury contract over the multisig signing channel. A no-op unless a
   * `treasuryChannel` was wired in by the deployment.
   *
   * @param {number} xlmBalance
   * @returns {Promise<{ triggered: boolean, reason?: string, treasury?: object }>}
   */
  async requestTreasuryTopUp(xlmBalance) {
    if (!this.treasuryChannel || !this.treasuryChannel.isConfigured) {
      return { triggered: false, reason: 'treasury_not_configured' };
    }

    const shortfallXlm = Math.max(this.targetBalanceXlm - xlmBalance, 0);
    if (shortfallXlm <= 0) {
      return { triggered: false, reason: 'above_target' };
    }

    try {
      const result = await this.treasuryChannel.requestTopUp({
        amountXlm: shortfallXlm,
        reason: `keeper_balance_${xlmBalance.toFixed(2)}_xlm`,
      });
      this.metrics?.increment?.('treasuryRefillRequestedTotal');
      return { triggered: true, treasury: result };
    } catch (error) {
      this.metrics?.increment?.('treasuryRefillRequestFailedTotal');
      this.logger.error('Treasury refill request failed', { error: error.message });
      return { triggered: false, reason: 'treasury_request_failed', error: error.message };
    }
  }

  /**
   * Builds, signs, and submits a `swap_exact_tokens_for_tokens` call
   * against `routerContractId`, following the Soroswap-style router
   * interface: `(amount_in, amount_out_min, path, to, deadline)`.
   *
   * Amounts are expressed in the router's native i128 unit (stroops for
   * XLM); `amountIn` here is the full available source-asset balance,
   * passed in as-is by the caller (already in that asset's smallest unit).
   */
  async _executeSwap({ sourceAssetContractId, sourceBalance, targetXlmAmount }) {
    const publicKey = this.keypair.publicKey();
    const account = await this.server.getAccount(publicKey);
    const router = new Contract(this.routerContractId);

    const amountIn = BigInt(Math.floor(sourceBalance));
    const minOutXlm = BigInt(Math.floor(targetXlmAmount * (1 - this.maxSlippage) * STROOPS_PER_XLM));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5-minute deadline

    const path = xdr.ScVal.scvVec([
      Address.fromString(sourceAssetContractId).toScVal(),
      Address.fromString(this.xlmContractId).toScVal(),
    ]);

    const tx = new TransactionBuilder(account, {
      fee: (Number(BASE_FEE) * 10).toString(),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        router.call(
          'swap_exact_tokens_for_tokens',
          xdr.ScVal.scvI128(xdr.Int128.fromString(amountIn.toString())),
          xdr.ScVal.scvI128(xdr.Int128.fromString(minOutXlm.toString())),
          path,
          Address.fromString(publicKey).toScVal(),
          xdr.ScVal.scvU64(xdr.Uint64.fromString(deadline.toString())),
        ),
      )
      .setTimeout(60)
      .build();

    const simResult = await this.server.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
      throw new Error(`Swap simulation failed: ${simResult.error || 'unknown error'}`);
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(this.keypair);

    const sendResult = await this.server.sendTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      throw new Error(`Swap submission failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    return { txHash: sendResult.hash, amountIn: amountIn.toString(), minOutXlm: minOutXlm.toString() };
  }
}

module.exports = { GasVaultRefillMonitor, TreasuryRefillChannel, STROOPS_PER_XLM };

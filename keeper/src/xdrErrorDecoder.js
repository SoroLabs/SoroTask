'use strict';

/**
 * xdrErrorDecoder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #1062 — Stellar XDR Structured Error Decoder & Automated Recovery Engine
 *
 * Decodes base64-encoded XDR error strings from Stellar RPC responses into
 * structured error objects. Maps specific Stellar and Soroban result codes
 * to automated recovery actions:
 *
 *   - txBAD_SEQ            → Resync sequence counter
 *   - txINSUFFICIENT_FEE   → Escalate fee and retry
 *   - HostError            → Quarantine task to DLQ
 *   - txBAD_AUTH           → Non-retryable, alert operator
 *   - txINSUFFICIENT_BALANCE → Top up wallet, retry
 *   - opUNDERFUNDED        → Top up wallet, non-retryable
 *
 * Uses @stellar/stellar-sdk xdr.TransactionResult.fromXDR for decoding.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { createLogger } = require('./logger');
const { createStructuredError, ErrorCategory } = require('./structuredErrors');

const logger = createLogger('xdr-error-decoder');

/**
 * Recovery action types dispatched by the automated recovery engine.
 */
const RecoveryAction = Object.freeze({
  RESYNC_SEQUENCE: 'resync_sequence',
  ESCALATE_FEE: 'escalate_fee',
  QUARANTINE_TO_DLQ: 'quarantine_to_dlq',
  TOP_UP_WALLET: 'top_up_wallet',
  RETRY_WITH_BACKOFF: 'retry_with_backoff',
  ALERT_OPERATOR: 'alert_operator',
  NO_ACTION: 'no_action',
});

/**
 * Maps Stellar result codes to recovery actions.
 * Keys are uppercased result codes (e.g., 'TX_BAD_SEQ').
 */
const RESULT_CODE_TO_RECOVERY = Object.freeze({
  TX_BAD_SEQ: RecoveryAction.RESYNC_SEQUENCE,
  TX_BAD_AUTH: RecoveryAction.ALERT_OPERATOR,
  TX_BAD_AUTH_EXTRA: RecoveryAction.ALERT_OPERATOR,
  TX_INSUFFICIENT_FEE: RecoveryAction.ESCALATE_FEE,
  TX_INSUFFICIENT_BALANCE: RecoveryAction.TOP_UP_WALLET,
  TX_TOO_EARLY: RecoveryAction.RETRY_WITH_BACKOFF,
  TX_TOO_LATE: RecoveryAction.RETRY_WITH_BACKOFF,
  TX_DUPLICATE: RecoveryAction.NO_ACTION,
  TX_ALREADY_IN_LEDGER: RecoveryAction.NO_ACTION,
  TX_NOT_SUPPORTED: RecoveryAction.ALERT_OPERATOR,
  TX_MISSING_OPERATION: RecoveryAction.ALERT_OPERATOR,
  TX_FAILED: RecoveryAction.QUARANTINE_TO_DLQ,
  TX_INTERNAL_ERROR: RecoveryAction.QUARANTINE_TO_DLQ,
  TX_MISSING_AUTH: RecoveryAction.ALERT_OPERATOR,
  TX_EXTRA_AUTH_SIGNERS: RecoveryAction.ALERT_OPERATOR,
  TX_FEE_BUMP_INNER�체Auth: RecoveryAction.ALERT_OPERATOR,
  TX_NOTῬHEAUTHORIZED: RecoveryAction.ALERT_OPERATOR,
});

/**
 * Maps Soroban/contract-level error codes to recovery actions.
 */
const SOROBAN_ERROR_TO_RECOVERY = Object.freeze({
  HOST_ERROR: RecoveryAction.QUARANTINE_TO_DLQ,
  CONTRACT_PANIC: RecoveryAction.QUARANTINE_TO_DLQ,
  CONTRACT_REVERT: RecoveryAction.QUARANTINE_TO_DLQ,
  INSUFFICIENT_GAS: RecoveryAction.ESCALATE_FEE,
  INVALID_TRANSACTION: RecoveryAction.QUARANTINE_TO_DLQ,
  SIMULATION_FAILED: RecoveryAction.QUARANTINE_TO_DLQ,
  RESOURCE_EXHAUSTION: RecoveryAction.QUARANTINE_TO_DLQ,
  UNKNOWN_HOST_ERROR: RecoveryAction.QUARANTINE_TO_DLQ,
});

/**
 * XDR error decoder that extracts structured information from Stellar
 * transaction result XDR and maps errors to automated recovery actions.
 */
class XDRErrorDecoder {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Logger instance
   * @param {Function} [options.sequenceResyncFn] - Callback for sequence resync
   * @param {Function} [options.feeEscalationFn] - Callback for fee escalation
   * @param {Function} [options.dlqQuarantineFn] - Callback for DLQ quarantine
   * @param {Function} [options.walletTopUpFn] - Callback for wallet top-up
   * @param {Function} [options.alertOperatorFn] - Callback for operator alerts
   */
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.sequenceResyncFn = options.sequenceResyncFn || null;
    this.feeEscalationFn = options.feeEscalationFn || null;
    this.dlqQuarantineFn = options.dlqQuarantineFn || null;
    this.walletTopUpFn = options.walletTopUpFn || null;
    this.alertOperatorFn = options.alertOperatorFn || null;
  }

  /**
   * Decode a base64-encoded XDR TransactionResult into a structured error.
   *
   * @param {string} xdrBase64 - Base64-encoded TransactionResult XDR
   * @returns {{ decoded: boolean, resultCode?: string, innerCode?: string, category?: string, raw?: object }}
   */
  decodeXDR(xdrBase64) {
    try {
      const { xdr } = require('@stellar/stellar-sdk');
      const result = xdr.TransactionResult.fromXDR(xdrBase64, 'base64');
      const resultTr = result.result();
      const resultCodes = result.code().name;

      let innerCode = null;
      let innerCodeName = null;

      if (resultTr && typeof resultTr.switch === 'function') {
        const branch = resultTr.switch().name;

        if (branch === 'opInner') {
          const opResult = resultTr.inner();
          if (opResult && typeof opResult.switch === 'function') {
            const opBranch = opResult.switch().name;
            if (opBranch === 'opInvokeHostFunction') {
              const hostResult = opResult.invokeHostFunction();
              if (hostResult && typeof hostResult.switch === 'function') {
                innerCode = hostResult.switch().name;
                innerCodeName = innerCode;
              }
            }
          }
        }
      }

      const normalizedCode = (resultCodes || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const category = this._mapToCategory(normalizedCode, innerCodeName);

      return {
        decoded: true,
        resultCode: normalizedCode,
        innerCode: innerCodeName,
        category,
        raw: {
          resultCodes: normalizedCode,
          innerCode: innerCodeName,
        },
      };
    } catch (err) {
      this.logger.warn('Failed to decode XDR TransactionResult', { error: err.message });
      return {
        decoded: false,
        resultCode: 'UNKNOWN',
        category: ErrorCategory.UNKNOWN,
        raw: { parseError: err.message },
      };
    }
  }

  /**
   * Decode an XDR result and determine the appropriate recovery action.
   *
   * @param {string} xdrBase64 - Base64-encoded TransactionResult XDR
   * @param {object} [context] - Additional context (taskId, feeMultiplier, etc.)
   * @returns {{ decoded: boolean, recoveryAction: string, error: object, metadata: object }}
   */
  decodeAndRecover(xdrBase64, context = {}) {
    const decoded = this.decodeXDR(xdrBase64);

    const recoveryAction = this._determineRecoveryAction(
      decoded.resultCode,
      decoded.innerCode,
      context,
    );

    const error = createStructuredError({
      code: decoded.innerCode || decoded.resultCode || 'UNKNOWN',
      message: this._buildErrorMessage(decoded),
      category: decoded.category,
      metadata: {
        ...context,
        recoveryAction,
        xdrDecoded: decoded.decoded,
        resultCode: decoded.resultCode,
        innerCode: decoded.innerCode,
      },
    });

    return {
      decoded: decoded.decoded,
      recoveryAction,
      error,
      metadata: {
        resultCode: decoded.resultCode,
        innerCode: decoded.innerCode,
        category: decoded.category,
        recoveryAction,
      },
    };
  }

  /**
   * Dispatch the automated recovery action.
   *
   * @param {string} action - One of RecoveryAction values
   * @param {object} context - Context including error info, taskId, etc.
   * @returns {Promise<{ dispatched: boolean, action: string, result?: any }>}
   */
  async dispatchRecovery(action, context = {}) {
    const { taskId, correlationId } = context;

    this.logger.info('Dispatching recovery action', {
      action,
      taskId,
      correlationId,
      resultCode: context.resultCode,
      innerCode: context.innerCode,
    });

    try {
      switch (action) {
        case RecoveryAction.RESYNC_SEQUENCE:
          if (this.sequenceResyncFn) {
            const result = await this.sequenceResyncFn(context);
            return { dispatched: true, action, result };
          }
          this.logger.warn('Sequence resync function not configured');
          return { dispatched: false, action };

        case RecoveryAction.ESCALATE_FEE:
          if (this.feeEscalationFn) {
            const result = await this.feeEscalationFn(context);
            return { dispatched: true, action, result };
          }
          this.logger.warn('Fee escalation function not configured');
          return { dispatched: false, action };

        case RecoveryAction.QUARANTINE_TO_DLQ:
          if (this.dlqQuarantineFn) {
            const result = await this.dlqQuarantineFn(context);
            return { dispatched: true, action, result };
          }
          this.logger.warn('DLQ quarantine function not configured');
          return { dispatched: false, action };

        case RecoveryAction.TOP_UP_WALLET:
          if (this.walletTopUpFn) {
            const result = await this.walletTopUpFn(context);
            return { dispatched: true, action, result };
          }
          this.logger.warn('Wallet top-up function not configured');
          return { dispatched: false, action };

        case RecoveryAction.ALERT_OPERATOR:
          if (this.alertOperatorFn) {
            const result = await this.alertOperatorFn(context);
            return { dispatched: true, action, result };
          }
          this.logger.warn('Operator alert function not configured');
          return { dispatched: false, action };

        case RecoveryAction.RETRY_WITH_BACKOFF:
          return { dispatched: true, action, result: 'retry_with_backoff' };

        case RecoveryAction.NO_ACTION:
          return { dispatched: true, action, result: 'no_action_needed' };

        default:
          this.logger.warn('Unknown recovery action', { action });
          return { dispatched: false, action };
      }
    } catch (err) {
      this.logger.error('Recovery action dispatch failed', {
        action,
        error: err.message,
        taskId,
      });
      return { dispatched: false, action, error: err.message };
    }
  }

  /**
   * Determine the recovery action for a given error code combination.
   * @private
   */
  _determineRecoveryAction(resultCode, innerCode, context) {
    // Check inner (Soroban) codes first
    if (innerCode) {
      const normalizedInner = innerCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      for (const [pattern, action] of Object.entries(SOROBAN_ERROR_TO_RECOVERY)) {
        if (normalizedInner.includes(pattern)) {
          return action;
        }
      }
    }

    // Check outer Stellar result codes
    if (resultCode) {
      const normalizedResult = resultCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (RESULT_CODE_TO_RECOVERY[normalizedResult]) {
        return RESULT_CODE_TO_RECOVERY[normalizedResult];
      }

      // Fuzzy matching for common patterns
      if (normalizedResult.includes('BAD_SEQ')) return RecoveryAction.RESYNC_SEQUENCE;
      if (normalizedResult.includes('INSUFFICIENT_FEE')) return RecoveryAction.ESCALATE_FEE;
      if (normalizedResult.includes('INSUFFICIENT_BALANCE') || normalizedResult.includes('UNDERFUNDED')) {
        return RecoveryAction.TOP_UP_WALLET;
      }
      if (normalizedResult.includes('BAD_AUTH')) return RecoveryAction.ALERT_OPERATOR;
    }

    // Fallback: check if the task is in a retryable context
    if (context.attemptNumber && context.attemptNumber > 3) {
      return RecoveryAction.QUARANTINE_TO_DLQ;
    }

    return RecoveryAction.RETRY_WITH_BACKOFF;
  }

  /**
   * Map a result code to an error category.
   * @private
   */
  _mapToCategory(resultCode, innerCode) {
    if (!resultCode) return ErrorCategory.UNKNOWN;

    const code = resultCode.toUpperCase();
    if (code.includes('BAD_SEQ') || code.includes('INSUFFICIENT')) return ErrorCategory.RPC;
    if (code.includes('BAD_AUTH')) return ErrorCategory.AUTH;
    if (code.includes('FAILED') || code.includes('INTERNAL')) return ErrorCategory.EXECUTION;
    if (innerCode && innerCode.includes('HOST')) return ErrorCategory.CONTRACT;
    if (innerCode && innerCode.includes('CONTRACT')) return ErrorCategory.CONTRACT;

    return ErrorCategory.UNKNOWN;
  }

  /**
   * Build a human-readable error message from decoded XDR.
   * @private
   */
  _buildErrorMessage(decoded) {
    const parts = ['Stellar transaction failed'];
    if (decoded.resultCode) parts.push(`(${decoded.resultCode})`);
    if (decoded.innerCode) parts.push(`- ${decoded.innerCode}`);
    if (!decoded.decoded) parts.push('- XDR decode failed');
    return parts.join(' ');
  }
}

/**
 * Create a pre-configured XDRErrorDecoder with default recovery handlers.
 *
 * @param {object} options - Same as XDRErrorDecoder constructor
 * @returns {XDRErrorDecoder}
 */
function createXDRErrorDecoder(options = {}) {
  return new XDRErrorDecoder(options);
}

module.exports = {
  XDRErrorDecoder,
  createXDRErrorDecoder,
  RecoveryAction,
  RESULT_CODE_TO_RECOVERY,
  SOROBAN_ERROR_TO_RECOVERY,
};

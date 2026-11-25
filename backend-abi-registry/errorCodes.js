/**
 * @fileoverview Canonical SoroTask error codes and human-readable message decoder.
 * Maps categorized on-chain Soroban contracterror discriminants into human-readable error descriptions.
 * @module backend-abi-registry/errorCodes
 */

const ERROR_CODES = {
  // ── 100..199: Authorization & Role-Based Access ──────────────────────────────
  100: { name: 'Unauthorized', category: 'Auth', message: 'Caller is not authorized to perform this action' },
  101: { name: 'UnauthorizedSlasher', category: 'Auth', message: 'Caller is not authorized to slash keeper' },
  102: { name: 'OperatorAlreadySet', category: 'Auth', message: 'Operator address has already been set' },
  103: { name: 'NotInitialized', category: 'Auth', message: 'Contract has not been initialized' },
  104: { name: 'AlreadyInitialized', category: 'Auth', message: 'Contract has already been initialized' },
  105: { name: 'FeatureDisabled', category: 'Auth', message: 'Requested protocol feature is disabled' },
  106: { name: 'InsufficientDelegation', category: 'Auth', message: 'Keeper delegation amount is insufficient' },
  107: { name: 'InvalidCommissionRate', category: 'Auth', message: 'Commission rate exceeds allowable maximum' },

  // ── 200..299: Task Lifecycle & Validation ────────────────────────────────────
  200: { name: 'InvalidInterval', category: 'TaskValidation', message: 'Task execution interval is invalid' },
  201: { name: 'TaskPaused', category: 'TaskValidation', message: 'Task execution is currently paused' },
  202: { name: 'TaskAlreadyPaused', category: 'TaskValidation', message: 'Task is already in a paused state' },
  203: { name: 'TaskAlreadyActive', category: 'TaskValidation', message: 'Task is already in an active state' },
  204: { name: 'TaskNotFound', category: 'TaskValidation', message: 'Specified task ID does not exist' },
  205: { name: 'DuplicateTask', category: 'TaskValidation', message: 'Duplicate task registration detected' },
  206: { name: 'InvalidPayload', category: 'TaskValidation', message: 'Task payload or arguments are malformed' },
  207: { name: 'ArgsTooMany', category: 'TaskValidation', message: 'Number of task arguments exceeds limit' },
  208: { name: 'ArgsTooLarge', category: 'TaskValidation', message: 'Total size of task arguments exceeds limit' },
  209: { name: 'BountyBelowMinimum', category: 'TaskValidation', message: 'Task execution bounty is below required minimum' },
  210: { name: 'InvalidBounty', category: 'TaskValidation', message: 'Task execution bounty parameters are invalid' },
  211: { name: 'InvalidUpgradeVersion', category: 'TaskValidation', message: 'Target WASM upgrade version is invalid' },
  212: { name: 'InvalidInsurancePolicy', category: 'TaskValidation', message: 'Insurance policy parameters are invalid' },

  // ── 300..399: Execution, Dependency & Reentrancy ─────────────────────────────
  300: { name: 'ReentrantCall', category: 'Execution', message: 'Reentrancy guard triggered on recursive entry' },
  301: { name: 'SelfDependency', category: 'Execution', message: 'Task cannot depend on itself' },
  302: { name: 'DependencyNotFound', category: 'Execution', message: 'Required task dependency not found' },
  303: { name: 'CircularDependency', category: 'Execution', message: 'Circular dependency cycle detected' },
  304: { name: 'DependencyBlocked', category: 'Execution', message: 'Task execution blocked by unresolved dependencies' },
  305: { name: 'DependencyLimitExceeded', category: 'Execution', message: 'Maximum dependency count exceeded' },
  306: { name: 'DependencyDepthExceeded', category: 'Execution', message: 'Maximum dependency tree depth exceeded' },
  307: { name: 'KeeperStakeTooLow', category: 'Execution', message: 'Keeper active stake is below minimum threshold' },
  308: { name: 'EmptyBundle', category: 'Execution', message: 'Task execution bundle contains zero steps' },
  309: { name: 'BundleTooLarge', category: 'Execution', message: 'Task bundle size exceeds block limit' },
  310: { name: 'BundleStepFailed', category: 'Execution', message: 'One or more bundle execution steps failed' },
  311: { name: 'BlockExecutionLimitReached', category: 'Execution', message: 'Per-block task execution cap reached' },
  312: { name: 'DecryptionFailed', category: 'Execution', message: 'Encrypted task parameter decryption failed' },
  313: { name: 'OptimisticClaimPending', category: 'Execution', message: 'Optimistic challenge claim is currently pending' },
  314: { name: 'NoOptimisticClaim', category: 'Execution', message: 'No active optimistic challenge claim found' },
  315: { name: 'ChallengeWindowClosed', category: 'Execution', message: 'Optimistic challenge window has expired' },
  316: { name: 'ChallengeWindowActive', category: 'Execution', message: 'Challenge window is still active' },
  317: { name: 'FraudProofInvalid', category: 'Execution', message: 'Supplied optimistic fraud proof is invalid' },

  // ── 400..499: Oracles, VRF & ZK Verifier ─────────────────────────────────────
  400: { name: 'OracleNotSet', category: 'Oracle', message: 'Required price or data oracle is not configured' },
  401: { name: 'OracleRequestFailed', category: 'Oracle', message: 'Oracle data request failed or reverted' },
  402: { name: 'OracleInvalidResponse', category: 'Oracle', message: 'Oracle returned invalid or unparseable data' },
  403: { name: 'OracleTimeout', category: 'Oracle', message: 'Oracle response exceeded timeout window' },
  404: { name: 'OracleUnsupportedProvider', category: 'Oracle', message: 'Specified oracle provider is not supported' },
  405: { name: 'VrfOracleNotSet', category: 'Oracle', message: 'VRF randomness oracle is not configured' },
  406: { name: 'InvalidVrfRequest', category: 'Oracle', message: 'VRF randomness request parameters are invalid' },
  407: { name: 'VrfRequestFailed', category: 'Oracle', message: 'VRF randomness fulfillment request failed' },
  408: { name: 'VrfAlreadyFulfilled', category: 'Oracle', message: 'VRF request has already been fulfilled' },
  409: { name: 'InvalidZkProof', category: 'Oracle', message: 'Zero-knowledge verification proof is invalid' },
  410: { name: 'InvalidVdfProof', category: 'Oracle', message: 'Verifiable delay function proof is invalid' },

  // ── 500..599: Yield, Flash Swaps & Treasury ──────────────────────────────────
  500: { name: 'InsufficientBalance', category: 'Treasury', message: 'Contract or task escrow balance is insufficient' },
  501: { name: 'YieldStrategyNotInitialized', category: 'Treasury', message: 'Yield strategy adapter has not been initialized' },
  502: { name: 'InvalidYieldStrategy', category: 'Treasury', message: 'Yield strategy configuration is invalid' },
  503: { name: 'YieldHarvestFailed', category: 'Treasury', message: 'Harvesting yield from external protocol failed' },
  504: { name: 'InsufficientYield', category: 'Treasury', message: 'Yield generated is below expected threshold' },
  505: { name: 'FlashSwapFailed', category: 'Treasury', message: 'Flash swap callback execution failed' },
  506: { name: 'InsufficientFlashProfit', category: 'Treasury', message: 'Flash swap did not generate required minimum profit' },
  507: { name: 'InvalidSlippage', category: 'Treasury', message: 'Slippage parameter exceeds maximum allowed tolerance' },

  // ── 600..699: Volatility & Circuit Breakers ──────────────────────────────────
  600: { name: 'VolatilityExceeded', category: 'Volatility', message: 'Asset volatility exceeds allowed tolerance limit' },
  601: { name: 'VolatilityCircuitBreakerTripped', category: 'Volatility', message: 'Volatility circuit breaker tripped; execution paused' },
  602: { name: 'VolatilityTimelockActive', category: 'Volatility', message: 'Volatility timelock is active; cannot execute until window expires' },
};

/**
 * Decodes an on-chain numeric error code into a human-readable error description.
 *
 * @param {number} code - On-chain error discriminant.
 * @returns {{ code: number, name: string, category: string, message: string }} Error metadata.
 */
function decodeErrorCode(code) {
  const info = ERROR_CODES[code];
  if (info) {
    return { code, ...info };
  }
  return {
    code,
    name: 'UnknownError',
    category: 'Unknown',
    message: `Unknown contract error code: ${code}`,
  };
}

module.exports = {
  ERROR_CODES,
  decodeErrorCode,
};

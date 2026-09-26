// Frontend error model for Soroban / Stellar / wallet failures.

export type ContractErrorCategory =
  // Wallet UX
  | "WALLET_NOT_INSTALLED"
  | "WALLET_LOCKED"
  | "WALLET_REJECTED"
  | "WRONG_NETWORK"
  // Funds
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_FEE"
  // Transaction-level
  | "BAD_SEQUENCE"
  | "BAD_AUTH"
  | "TX_TOO_LATE"
  | "TX_TOO_EARLY"
  | "DUPLICATE_TRANSACTION"
  // Soroban / contract
  | "SIMULATION_FAILED"
  | "CONTRACT_REVERT"
  | "INVALID_ARGS"
  | "INSUFFICIENT_GAS"
  | "STATE_EXPIRED"
  // Network / RPC
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  // Catchall
  | "UNKNOWN";

export type ContractErrorAction =
  | "retry"
  | "wait"
  | "fix_input"
  | "increase_gas"
  | "reconnect_wallet"
  | "switch_network"
  | "none";

export interface MappedContractError {
  category: ContractErrorCategory;
  title: string;
  userMessage: string;
  action: ContractErrorAction;
  retryable: boolean;
  errorCode?: number;
  errorName?: string;
  fixSuggestion?: string;
  debug: {
    name?: string;
    message: string;
    code?: string | number;
    raw?: unknown;
  };
}

export interface ContractErrorDiagnostic {
  code: number;
  name: string;
  category: ContractErrorCategory;
  title: string;
  explanation: string;
  fixSuggestion: string;
  action: ContractErrorAction;
}

export const CONTRACT_ERROR_DEFINITIONS: Record<number, { name: string; category: ContractErrorCategory; explanation: string; fixSuggestion: string; action: ContractErrorAction }> = {
  1: { name: "InvalidInterval", category: "INVALID_ARGS", explanation: "Task execution interval is invalid or below the protocol minimum.", fixSuggestion: "Set task execution interval to at least 10 seconds.", action: "fix_input" },
  2: { name: "Unauthorized", category: "BAD_AUTH", explanation: "Caller lacks required admin or creator authorization.", fixSuggestion: "Ensure your connected wallet address matches the task creator or admin.", action: "reconnect_wallet" },
  3: { name: "InsufficientBalance", category: "INSUFFICIENT_BALANCE", explanation: "Gas escrow or account XLM balance is insufficient to execute task.", fixSuggestion: "Increase gas escrow by depositing 50 XLM to your task balance.", action: "increase_gas" },
  4: { name: "NotInitialized", category: "SIMULATION_FAILED", explanation: "Target contract state has not been initialized.", fixSuggestion: "Invoke contract initialization before calling task methods.", action: "fix_input" },
  5: { name: "TaskPaused", category: "SIMULATION_FAILED", explanation: "Target task is currently paused by admin.", fixSuggestion: "Unpause the task using admin controls before executing.", action: "fix_input" },
  6: { name: "TaskAlreadyPaused", category: "SIMULATION_FAILED", explanation: "Task is already in paused state.", fixSuggestion: "No action required; task is paused.", action: "none" },
  7: { name: "TaskAlreadyActive", category: "SIMULATION_FAILED", explanation: "Task is already active.", fixSuggestion: "No action required; task is active.", action: "none" },
  8: { name: "SelfDependency", category: "INVALID_ARGS", explanation: "Task payload cannot specify itself as a dependency.", fixSuggestion: "Remove self-referencing task ID from dependencies.", action: "fix_input" },
  9: { name: "DependencyNotFound", category: "INVALID_ARGS", explanation: "Specified dependency task ID does not exist in ledger.", fixSuggestion: "Verify dependency task ID and update payload.", action: "fix_input" },
  10: { name: "CircularDependency", category: "INVALID_ARGS", explanation: "Circular dependency loop detected between tasks.", fixSuggestion: "Break circular dependency chain in task DAG.", action: "fix_input" },
  11: { name: "DependencyBlocked", category: "CONTRACT_REVERT", explanation: "Prerequisite dependency task has not finalized successfully.", fixSuggestion: "Wait for dependency task to complete or resolve its failure.", action: "wait" },
  12: { name: "AlreadyInitialized", category: "CONTRACT_REVERT", explanation: "Contract has already been initialized.", fixSuggestion: "Skip initialization call.", action: "none" },
  13: { name: "UnauthorizedSlasher", category: "BAD_AUTH", explanation: "Caller is not an authorized slasher role.", fixSuggestion: "Connect with registered slasher key.", action: "reconnect_wallet" },
  14: { name: "KeeperStakeTooLow", category: "INSUFFICIENT_BALANCE", explanation: "Keeper stake is below required minimum threshold.", fixSuggestion: "Stake additional tokens to meet keeper minimum requirement.", action: "fix_input" },
  15: { name: "OperatorAlreadySet", category: "CONTRACT_REVERT", explanation: "Keeper operator address has already been configured.", fixSuggestion: "Revoke current operator before assigning a new one.", action: "fix_input" },
  16: { name: "InvalidPayload", category: "INVALID_ARGS", explanation: "Serialized task argument payload fails validation.", fixSuggestion: "Re-encode arguments according to target contract ABI.", action: "fix_input" },
  17: { name: "ReentrantCall", category: "CONTRACT_REVERT", explanation: "Reentrant execution call detected.", fixSuggestion: "Ensure state mutations precede external calls.", action: "none" },
  18: { name: "DependencyLimitExceeded", category: "INVALID_ARGS", explanation: "Task dependency count exceeds maximum limit (8).", fixSuggestion: "Reduce task dependencies to 8 or fewer.", action: "fix_input" },
  19: { name: "DependencyDepthExceeded", category: "INVALID_ARGS", explanation: "Dependency graph depth exceeds maximum depth (5).", fixSuggestion: "Flatten dependency graph depth to 5 or fewer levels.", action: "fix_input" },
  20: { name: "VrfOracleNotSet", category: "SIMULATION_FAILED", explanation: "VRF oracle contract address is missing.", fixSuggestion: "Configure valid VRF oracle address in settings.", action: "fix_input" },
  21: { name: "InvalidVrfRequest", category: "INVALID_ARGS", explanation: "VRF request seed or parameters are invalid.", fixSuggestion: "Regenerate VRF randomness seed.", action: "retry" },
  22: { name: "VrfRequestFailed", category: "CONTRACT_REVERT", explanation: "VRF request execution failed on host.", fixSuggestion: "Retry VRF request submission.", action: "retry" },
  23: { name: "VrfAlreadyFulfilled", category: "CONTRACT_REVERT", explanation: "VRF seed has already been fulfilled.", fixSuggestion: "Generate a new VRF request ID.", action: "retry" },
  24: { name: "YieldStrategyNotInitialized", category: "SIMULATION_FAILED", explanation: "Yield harvesting strategy is not initialized.", fixSuggestion: "Initialize yield strategy before harvesting.", action: "fix_input" },
  25: { name: "InvalidYieldStrategy", category: "INVALID_ARGS", explanation: "Yield strategy configuration parameters are invalid.", fixSuggestion: "Update strategy protocol address and parameters.", action: "fix_input" },
  26: { name: "YieldHarvestFailed", category: "CONTRACT_REVERT", explanation: "Yield harvest execution reverted.", fixSuggestion: "Check DeFi protocol liquidity and harvest bounds.", action: "retry" },
  27: { name: "InsufficientYield", category: "CONTRACT_REVERT", explanation: "Harvested yield is below minimum threshold.", fixSuggestion: "Wait for yield accumulation before harvesting.", action: "wait" },
  28: { name: "OracleNotSet", category: "SIMULATION_FAILED", explanation: "Price oracle contract is not configured.", fixSuggestion: "Set price oracle address in settings.", action: "fix_input" },
  29: { name: "OracleRequestFailed", category: "CONTRACT_REVERT", explanation: "Price oracle request failed.", fixSuggestion: "Retry oracle request after provider sync.", action: "retry" },
  30: { name: "OracleInvalidResponse", category: "CONTRACT_REVERT", explanation: "Oracle returned malformed or negative data.", fixSuggestion: "Verify oracle feed configuration.", action: "fix_input" },
  31: { name: "OracleTimeout", category: "TIMEOUT", explanation: "Price oracle response timed out.", fixSuggestion: "Retry request with fresh oracle response.", action: "wait" },
  32: { name: "OracleUnsupportedProvider", category: "INVALID_ARGS", explanation: "Oracle provider type is unsupported.", fixSuggestion: "Select supported provider (Chainlink or Band).", action: "fix_input" },
  33: { name: "InvalidInsurancePolicy", category: "INVALID_ARGS", explanation: "Insurance policy limits are invalid.", fixSuggestion: "Update insurance coverage parameters.", action: "fix_input" },
  34: { name: "ArgsTooMany", category: "INVALID_ARGS", explanation: "Task payload contains too many arguments (>32).", fixSuggestion: "Reduce argument count to 32 or fewer.", action: "fix_input" },
  35: { name: "ArgsTooLarge", category: "INVALID_ARGS", explanation: "Serialized task payload exceeds 4KB limit.", fixSuggestion: "Reduce serialized payload size below 4096 bytes.", action: "fix_input" },
  36: { name: "TaskNotFound", category: "SIMULATION_FAILED", explanation: "Task ID was not found in contract storage.", fixSuggestion: "Confirm task registration and ID.", action: "fix_input" },
  37: { name: "InvalidUpgradeVersion", category: "INVALID_ARGS", explanation: "WASM upgrade version must be strictly greater than current version.", fixSuggestion: "Increment WASM upgrade version counter.", action: "fix_input" },
  38: { name: "DuplicateTask", category: "DUPLICATE_TRANSACTION", explanation: "Task payload matches an existing registered task.", fixSuggestion: "Modify task payload parameters.", action: "fix_input" },
  39: { name: "BountyBelowMinimum", category: "INSUFFICIENT_BALANCE", explanation: "Bounty reward is below protocol minimum.", fixSuggestion: "Increase bounty reward contribution.", action: "fix_input" },
  40: { name: "InvalidBounty", category: "INVALID_ARGS", explanation: "Bounty token or parameters are invalid.", fixSuggestion: "Check bounty asset address and value.", action: "fix_input" },
  41: { name: "FeatureDisabled", category: "SIMULATION_FAILED", explanation: "Protocol feature disabled by governance.", fixSuggestion: "Wait for governance feature activation proposal.", action: "none" },
  42: { name: "InvalidZkProof", category: "CONTRACT_REVERT", explanation: "Zero-knowledge proof verification failed.", fixSuggestion: "Re-generate ZK proof with valid witness input.", action: "retry" },
  43: { name: "FlashSwapFailed", category: "CONTRACT_REVERT", explanation: "Flash swap transaction reverted.", fixSuggestion: "Check liquidity pool path and balance.", action: "retry" },
  44: { name: "InsufficientFlashProfit", category: "CONTRACT_REVERT", explanation: "Flash swap arbitrage profit fell below minimum threshold.", fixSuggestion: "Adjust trade route or profit tolerance.", action: "fix_input" },
  45: { name: "InvalidSlippage", category: "CONTRACT_REVERT", explanation: "Trade slippage exceeded maximum threshold.", fixSuggestion: "Increase slippage tolerance setting.", action: "fix_input" },
  46: { name: "OptimisticClaimPending", category: "CONTRACT_REVERT", explanation: "Optimistic claim is open and pending challenge window.", fixSuggestion: "Wait for challenge window ledgers to elapse.", action: "wait" },
  47: { name: "NoOptimisticClaim", category: "SIMULATION_FAILED", explanation: "No active optimistic claim found for task.", fixSuggestion: "Submit optimistic claim prior to finalization.", action: "fix_input" },
  48: { name: "ChallengeWindowClosed", category: "CONTRACT_REVERT", explanation: "Challenge window has closed for claim.", fixSuggestion: "Finalize optimistic claim instead of challenging.", action: "fix_input" },
  49: { name: "ChallengeWindowActive", category: "CONTRACT_REVERT", explanation: "Optimistic challenge window is still active.", fixSuggestion: "Wait for challenge window ledgers to expire.", action: "wait" },
  50: { name: "FraudProofInvalid", category: "CONTRACT_REVERT", explanation: "Fraud proof verification failed.", fixSuggestion: "Provide valid state trace diff for fraud proof.", action: "retry" },
  51: { name: "EmptyBundle", category: "INVALID_ARGS", explanation: "Task bundle contains no steps.", fixSuggestion: "Add at least one step to task bundle.", action: "fix_input" },
  52: { name: "BundleTooLarge", category: "INVALID_ARGS", explanation: "Task bundle exceeds maximum steps (16).", fixSuggestion: "Split bundle into 16 or fewer steps.", action: "fix_input" },
  53: { name: "BundleStepFailed", category: "CONTRACT_REVERT", explanation: "Atomic task bundle step execution failed.", fixSuggestion: "Check individual step parameters and dependencies.", action: "fix_input" },
  54: { name: "BlockExecutionLimitReached", category: "RATE_LIMITED", explanation: "Rate limit reached for current ledger block.", fixSuggestion: "Wait for next ledger block execution slot.", action: "wait" },
  55: { name: "DecryptionFailed", category: "CONTRACT_REVERT", explanation: "In-memory parameter decryption failed.", fixSuggestion: "Check encryption key and nonce.", action: "fix_input" },
  56: { name: "InsufficientDelegation", category: "INSUFFICIENT_BALANCE", explanation: "Delegation stake is insufficient.", fixSuggestion: "Increase delegated stake balance.", action: "fix_input" },
  57: { name: "InvalidCommissionRate", category: "INVALID_ARGS", explanation: "Operator commission rate exceeds 10,000 bps.", fixSuggestion: "Set commission rate between 0 and 10000 basis points.", action: "fix_input" },
  58: { name: "InvalidVdfProof", category: "CONTRACT_REVERT", explanation: "VDF proof verification failed.", fixSuggestion: "Recompute VDF proof with valid seed.", action: "retry" },
  59: { name: "UpgradeNotProposed", category: "SIMULATION_FAILED", explanation: "WASM upgrade proposal does not exist.", fixSuggestion: "Submit upgrade proposal first.", action: "fix_input" },
  60: { name: "UpgradeTimelockActive", category: "CONTRACT_REVERT", explanation: "Upgrade timelock delay has not elapsed.", fixSuggestion: "Wait for upgrade timelock delay to expire.", action: "wait" },
  65: { name: "UnpauseNotProposed", category: "SIMULATION_FAILED", explanation: "Unpause proposal not found.", fixSuggestion: "Submit unpause proposal to governance.", action: "fix_input" },
  66: { name: "UnpauseTimelockActive", category: "CONTRACT_REVERT", explanation: "Unpause timelock delay is active.", fixSuggestion: "Wait 24 hours for unpause timelock to expire.", action: "wait" },
  67: { name: "InvalidPauseThreshold", category: "INVALID_ARGS", explanation: "Pause threshold value is invalid.", fixSuggestion: "Set valid pause threshold parameter.", action: "fix_input" },
  68: { name: "TaskStillActive", category: "CONTRACT_REVERT", explanation: "Task is active and cannot be refunded.", fixSuggestion: "Pause task before requesting gas refund.", action: "fix_input" },
  69: { name: "AbandonmentPeriodNotElapsed", category: "CONTRACT_REVERT", explanation: "Task has not been inactive for required 90-day period.", fixSuggestion: "Wait for 90 days of inactivity before claiming refund.", action: "wait" },
  411: { name: "OracleStale", category: "CONTRACT_REVERT", explanation: "Oracle price feed data is older than 300 seconds.", fixSuggestion: "Fetch fresh price data update from oracle.", action: "retry" },
  412: { name: "OracleDeviationExceeded", category: "CONTRACT_REVERT", explanation: "Price deviation across oracle feeds exceeds 250 bps.", fixSuggestion: "Wait for oracle price convergence.", action: "wait" },
  413: { name: "InsufficientOracleFeeds", category: "SIMULATION_FAILED", explanation: "Fewer than required minimum oracle price feeds active.", fixSuggestion: "Activate additional oracle feeds.", action: "fix_input font" },
  414: { name: "VrfFulfillmentTooEarly", category: "CONTRACT_REVERT", explanation: "VRF reveal submitted before minimum delay elapsed.", fixSuggestion: "Wait for minimum delay ledgers before revealing VRF.", action: "wait" },
  415: { name: "VrfFulfillmentExpired", category: "CONTRACT_REVERT", explanation: "VRF reveal window has expired.", fixSuggestion: "Re-submit VRF commitment.", action: "retry" },
  416: { name: "VrfCommitAlreadyRevealed", category: "CONTRACT_REVERT", explanation: "VRF commitment has already been revealed.", fixSuggestion: "Commit a fresh VRF seed.", action: "retry" },
  417: { name: "InvalidVrfCommit", category: "CONTRACT_REVERT", explanation: "VRF commit hash does not match revealed seed.", fixSuggestion: "Verify VRF seed and hash.", action: "fix_input" },
  418: { name: "KeeperBondInsufficient", category: "INSUFFICIENT_BALANCE", explanation: "Keeper bond balance is below minimum requirement (100 XLM).", fixSuggestion: "Increase gas escrow by 50 XLM or top up keeper bond.", action: "increase_gas" },
  419: { name: "KeeperSlashed", category: "CONTRACT_REVERT", explanation: "Keeper address has been slashed for misbehavior.", fixSuggestion: "Re-register keeper with fresh stake bond.", action: "reconnect_wallet" },
  420: { name: "KeeperNotBonded", category: "SIMULATION_FAILED", explanation: "Keeper address is not bonded in contract.", fixSuggestion: "Deposit keeper bond before claiming tasks.", action: "fix_input" },
  600: { name: "VolatilityExceeded", category: "CONTRACT_REVERT", explanation: "Market volatility exceeded safe operating parameters.", fixSuggestion: "Wait for market volatility to stabilize.", action: "wait" },
  601: { name: "VolatilityCircuitBreakerTripped", category: "CONTRACT_REVERT", explanation: "Volatility circuit breaker tripped.", fixSuggestion: "Admin reset required after market stabilization.", action: "wait" },
  602: { name: "VolatilityTimelockActive", category: "CONTRACT_REVERT", explanation: "Volatility reset timelock active.", fixSuggestion: "Wait for circuit breaker timelock to expire.", action: "wait" },
  700: { name: "UnsupportedSourceChain", category: "INVALID_ARGS", explanation: "Cross-chain source chain ID is unsupported.", fixSuggestion: "Select supported CCIP source chain.", action: "switch_network" },
  701: { name: "InvalidCrossChainPayload", category: "INVALID_ARGS", explanation: "Cross-chain payload format is invalid.", fixSuggestion: "Format CCIP payload per gateway spec.", action: "fix_input" },
  702: { name: "InvalidCrossChainSignature", category: "BAD_AUTH", explanation: "Cross-chain gateway signature is invalid.", fixSuggestion: "Verify relayer signatures.", action: "fix_input" },
  703: { name: "GatewayNotConfigured", category: "SIMULATION_FAILED", explanation: "Cross-chain CCIP gateway is not configured.", fixSuggestion: "Set CCIP gateway contract address.", action: "fix_input" },
  704: { name: "GatewayUnauthorized", category: "BAD_AUTH", explanation: "Caller is not an authorized CCIP gateway.", fixSuggestion: "Submit message via registered gateway.", action: "reconnect_wallet" },
  705: { name: "CrossChainNonceReplay", category: "DUPLICATE_TRANSACTION", explanation: "Cross-chain message nonce replay detected.", fixSuggestion: "Use incremented cross-chain nonce.", action: "retry" },
};

/**
 * Parses Soroban XDR error streams or raw strings (e.g., "HostError: Error(Contract, #3)" or "Error(Contract, #418)")
 * to extract the contract error code number.
 */
export function decodeSorobanContractError(input: unknown): ContractErrorDiagnostic | null {
  if (typeof input === "number") {
    const def = CONTRACT_ERROR_DEFINITIONS[input];
    if (def) {
      return {
        code: input,
        name: def.name,
        category: def.category,
        title: `Contract Error #${input}: ${def.name}`,
        explanation: def.explanation,
        fixSuggestion: def.fixSuggestion,
        action: def.action,
      };
    }
  }

  const str = String(input || "");
  const match = str.match(/Error\(\s*Contract\s*,\s*#?(\d+)\s*\)/i) || str.match(/ContractError\s*#?(\d+)/i) || str.match(/#(\d+)/);

  if (match && match[1]) {
    const codeNum = parseInt(match[1], 10);
    const def = CONTRACT_ERROR_DEFINITIONS[codeNum];
    if (def) {
      return {
        code: codeNum,
        name: def.name,
        category: def.category,
        title: `Contract Error #${codeNum}: ${def.name}`,
        explanation: def.explanation,
        fixSuggestion: def.fixSuggestion,
        action: def.action,
      };
    }
  }

  return null;
}

export function mapContractError(input: unknown): MappedContractError {
  const diagnostic = decodeSorobanContractError(input);

  if (diagnostic) {
    return {
      category: diagnostic.category,
      title: diagnostic.title,
      userMessage: `${diagnostic.explanation} ${diagnostic.fixSuggestion}`,
      action: diagnostic.action,
      retryable: diagnostic.action === "retry" || diagnostic.action === "wait",
      errorCode: diagnostic.code,
      errorName: diagnostic.name,
      fixSuggestion: diagnostic.fixSuggestion,
      debug: {
        name: diagnostic.name,
        message: String(input),
        code: diagnostic.code,
        raw: input,
      },
    };
  }

  return {
    category: "UNKNOWN",
    title: "Something went wrong",
    userMessage: "We hit an unexpected error. Check input parameters or retry.",
    action: "retry",
    retryable: true,
    debug: {
      message: String(input),
      raw: input,
    },
  };
}

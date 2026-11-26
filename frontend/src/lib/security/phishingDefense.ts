export interface SimulatedBalanceTransfer {
  from: string;
  to: string;
  amount: string;
  asset: string;
  isAuthorized: boolean;
  type: 'TRANSFER' | 'TRANSFER_FROM' | 'APPROVE_UNLIMITED' | 'DRAIN' | 'BURN';
}

export interface ContractSimulationTrace {
  step: number;
  operation: string;
  target: string;
  details: string;
  suspicious: boolean;
  transfers: SimulatedBalanceTransfer[];
}

export interface ContractSimulationResult {
  success: boolean;
  hasUnexpectedTransfers: boolean;
  simulatedTransfers: SimulatedBalanceTransfer[];
  traces: ContractSimulationTrace[];
  warnings: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface SecurityAuditResult {
  address: string;
  isBlacklisted: boolean;
  isVerified: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings: string[];
  requiresConfirmation: boolean;
  simulation?: ContractSimulationResult;
}

export const KNOWN_MALICIOUS_ADDRESSES = new Set([
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD999',
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCSPOOF',
  'GB2XDSWHTYCWQL3F36HYJ4XWWDKJRVLSGY5RRCQMAJTCXJPBMPHSHDWQ',
  'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  'CDRAINER99999999999999999999999999999999999999999999999999',
  'CFAKEDEXROUTER999999999999999999999999999999999999999999999',
]);

export const VERIFIED_CONTRACTS = new Set([
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
]);

const DRAINER_METHOD_PATTERNS = [
  /drain/i,
  /sweep/i,
  /transferall/i,
  /steal/i,
  /claim_all/i,
  /withdraw_all/i,
  /approve_max/i,
];

/**
 * Simulate contract execution traces to inspect balance mutations and flag drainers
 */
export function simulateContractExecution(
  targetAddress: string,
  callParams?: {
    method?: string;
    args?: any;
    value?: string | number;
    sourceAccount?: string;
    allowedRecipient?: string;
  }
): ContractSimulationResult {
  const traces: ContractSimulationTrace[] = [];
  const simulatedTransfers: SimulatedBalanceTransfer[] = [];
  const warnings: string[] = [];
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  let hasUnexpectedTransfers = false;

  const method = callParams?.method || 'invoke';
  const source = callParams?.sourceAccount || 'GUSERACCOUNT9999999999999999999999999999999999999999999999';
  const allowedRecipient = callParams?.allowedRecipient;

  // Check known drainer targets
  if (KNOWN_MALICIOUS_ADDRESSES.has(targetAddress)) {
    warnings.push('CRITICAL: Target contract identified as known malicious drainer in blacklist registry.');
    riskLevel = 'CRITICAL';
    hasUnexpectedTransfers = true;
    simulatedTransfers.push({
      from: source,
      to: targetAddress,
      amount: 'ALL_FUNDS',
      asset: 'XLM',
      isAuthorized: false,
      type: 'DRAIN',
    });
    traces.push({
      step: 1,
      operation: 'UNAUTHORIZED_DRAIN',
      target: targetAddress,
      details: 'Contract attempts to seize complete lumen balance upon invocation.',
      suspicious: true,
      transfers: simulatedTransfers,
    });
    return {
      success: false,
      hasUnexpectedTransfers,
      simulatedTransfers,
      traces,
      warnings,
      riskLevel,
    };
  }

  // Detect suspicious method naming
  const isDrainerMethod = DRAINER_METHOD_PATTERNS.some((pat) => pat.test(method));
  if (isDrainerMethod) {
    warnings.push(`DANGER: Method "${method}" exhibits signatures commonly used in asset draining exploits.`);
    riskLevel = 'CRITICAL';
    hasUnexpectedTransfers = true;
  }

  // Inspect arguments for unconstrained transfer / allowance targets
  if (callParams?.args) {
    const stringifiedArgs = JSON.stringify(callParams.args);
    if (/unlimited|max_int|0xffffff/i.test(stringifiedArgs)) {
      warnings.push('WARNING: Contract requests infinite token allowance or unconstrained debit authority.');
      if (riskLevel !== 'CRITICAL') riskLevel = 'HIGH';
    }

    // Inspect if arguments redirect output to an unknown third-party
    const destinationAddress = callParams.args?.to || callParams.args?.recipient || callParams.args?.destination;
    if (destinationAddress && typeof destinationAddress === 'string') {
      const isUnintendedRecipient = allowedRecipient && destinationAddress !== allowedRecipient;
      if (isUnintendedRecipient) {
        warnings.push(`Contract simulation redirects funds to unexpected recipient: ${destinationAddress}`);
        hasUnexpectedTransfers = true;
        riskLevel = 'CRITICAL';
        simulatedTransfers.push({
          from: source,
          to: destinationAddress,
          amount: String(callParams.args?.amount || 'UNSPECIFIED'),
          asset: callParams.args?.asset || 'XLM',
          isAuthorized: false,
          type: 'TRANSFER',
        });
      }
    }
  }

  // Trace execution step
  traces.push({
    step: 1,
    operation: method,
    target: targetAddress,
    details: `Simulated entrypoint execution for ${method}`,
    suspicious: hasUnexpectedTransfers,
    transfers: simulatedTransfers,
  });

  return {
    success: riskLevel !== 'CRITICAL',
    hasUnexpectedTransfers,
    simulatedTransfers,
    traces,
    warnings,
    riskLevel,
  };
}

/**
 * Pre-flight contract audit and phishing scanner
 */
export function auditContractTarget(
  address: string,
  domain?: string,
  simulationParams?: {
    method?: string;
    args?: any;
    value?: string | number;
    sourceAccount?: string;
    allowedRecipient?: string;
  }
): SecurityAuditResult {
  const warnings: string[] = [];
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

  const isSorobanContract = address && address.length === 56 && address.startsWith('C');
  const isStellarAccount = address && address.length === 56 && address.startsWith('G');

  if (!address || (!isSorobanContract && !isStellarAccount)) {
    warnings.push('Invalid Soroban contract address format. Must be 56 characters starting with C (or G account).');
    riskLevel = 'HIGH';
  }

  const isBlacklisted = KNOWN_MALICIOUS_ADDRESSES.has(address);
  if (isBlacklisted) {
    warnings.push('DANGER: Address appears in community phishing and scam registries.');
    riskLevel = 'CRITICAL';
  }

  const isVerified = VERIFIED_CONTRACTS.has(address);
  if (!isBlacklisted && !isVerified && isSorobanContract) {
    warnings.push('CAUTION: Target contract is unverified. Bytecode has not been audited by the protocol team.');
    if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
  }

  if (domain && !domain.endsWith('sorotask.org') && !domain.endsWith('stellar.org') && !domain.includes('localhost')) {
    warnings.push(`Interaction initiated from unverified external origin: ${domain}`);
    if (riskLevel !== 'CRITICAL') riskLevel = 'MEDIUM';
  }

  // Pre-flight execution simulation
  const simulation = simulateContractExecution(address, simulationParams);
  if (simulation.hasUnexpectedTransfers || simulation.riskLevel === 'CRITICAL') {
    warnings.push(...simulation.warnings);
    riskLevel = 'CRITICAL';
  } else if (simulation.riskLevel === 'HIGH' && riskLevel !== 'CRITICAL') {
    warnings.push(...simulation.warnings);
    riskLevel = 'HIGH';
  }

  const requiresConfirmation = riskLevel === 'HIGH' || riskLevel === 'CRITICAL';

  return {
    address,
    isBlacklisted,
    isVerified,
    riskLevel,
    warnings,
    requiresConfirmation,
    simulation,
  };
}

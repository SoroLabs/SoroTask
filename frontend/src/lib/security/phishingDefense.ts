export interface SecurityAuditResult {
  address: string;
  isBlacklisted: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings: string[];
}

export const KNOWN_MALICIOUS_ADDRESSES = new Set([
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD999',
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCSPOOF',
]);

export function auditContractTarget(address: string, domain?: string): SecurityAuditResult {
  const warnings: string[] = [];
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

  if (!address || address.length !== 56 || !address.startsWith('C')) {
    warnings.push('Invalid Soroban contract address format.');
    riskLevel = 'HIGH';
  }

  if (KNOWN_MALICIOUS_ADDRESSES.has(address)) {
    warnings.push('Address appears in community phishing and scam registries.');
    riskLevel = 'CRITICAL';
  }

  if (domain && !domain.endsWith('sorotask.org') && !domain.endsWith('stellar.org') && !domain.includes('localhost')) {
    warnings.push(`Interaction initiated from unverified external origin: ${domain}`);
    if (riskLevel !== 'CRITICAL') riskLevel = 'MEDIUM';
  }

  return {
    address,
    isBlacklisted: KNOWN_MALICIOUS_ADDRESSES.has(address),
    riskLevel,
    warnings,
  };
}

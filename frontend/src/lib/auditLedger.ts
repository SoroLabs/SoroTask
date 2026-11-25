export interface TokenAllowance {
  id: string;
  owner: string;
  network: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  spenderAddress: string;
  amount: string;
  expirationLedger: number | null;
  observedLedger: number | null;
}

export type AllowanceRisk = 'high' | 'moderate' | 'low';

export interface AuditedAllowance extends TokenAllowance {
  risk: AllowanceRisk;
  isUnlimited: boolean;
  formattedAmount: string;
}

export interface AllowanceAuditSummary {
  postureScore: number;
  activeCount: number;
  highRiskCount: number;
  moderateRiskCount: number;
}

export const MAX_ALLOWANCE_EXPORT_BYTES = 2_000_000;
export const MAX_ALLOWANCE_ENTRIES = 500;
const MAX_I128 = (1n << 127n) - 1n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  index: number,
): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Allowance ${index + 1} is missing ${key}.`);
  }
  return value.trim();
}

function requiredInteger(
  row: Record<string, unknown>,
  key: string,
  index: number,
  maximum: number,
): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`Allowance ${index + 1} has an invalid ${key}.`);
  }
  return value;
}

function optionalLedger(
  row: Record<string, unknown>,
  key: string,
  index: number,
): number | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Allowance ${index + 1} has an invalid ${key}.`);
  }
  return value;
}

function normalizeAllowance(value: unknown, index: number): TokenAllowance {
  if (!isRecord(value)) {
    throw new Error(`Allowance ${index + 1} must be an object.`);
  }

  const owner = requiredString(value, 'owner', index);
  const tokenAddress = requiredString(value, 'tokenAddress', index);
  const spenderAddress = requiredString(value, 'spenderAddress', index);
  const amount = requiredString(value, 'amount', index);
  const tokenSymbol = requiredString(value, 'tokenSymbol', index);
  const network = requiredString(value, 'network', index);
  const tokenDecimals = requiredInteger(value, 'tokenDecimals', index, 38);

  if (!/^G[A-Z2-7]{55}$/.test(owner)) {
    throw new Error(`Allowance ${index + 1} has an invalid Stellar owner address.`);
  }
  if (!/^C[A-Z2-7]{55}$/.test(tokenAddress)) {
    throw new Error(`Allowance ${index + 1} has an invalid token contract address.`);
  }
  if (!/^G[A-Z2-7]{55}$/.test(spenderAddress)) {
    throw new Error(`Allowance ${index + 1} has an invalid spender address.`);
  }
  if (!/^\d+$/.test(amount)) {
    throw new Error(`Allowance ${index + 1} amount must be a non-negative integer in base units.`);
  }

  const rawId = value.id;
  const id = typeof rawId === 'string' && rawId.trim()
    ? rawId.trim()
    : `${network}:${tokenAddress}:${spenderAddress}`;

  return {
    id,
    owner,
    network,
    tokenAddress,
    tokenSymbol,
    tokenDecimals,
    spenderAddress,
    amount,
    expirationLedger: optionalLedger(value, 'expirationLedger', index),
    observedLedger: optionalLedger(value, 'observedLedger', index),
  };
}

export function parseAllowanceExport(json: string): TokenAllowance[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The allowance export is not valid JSON.');
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.allowances)) {
    throw new Error('Expected an export object with an allowances array.');
  }
  if (parsed.allowances.length > MAX_ALLOWANCE_ENTRIES) {
    throw new Error(`The export exceeds the ${MAX_ALLOWANCE_ENTRIES}-allowance safety limit.`);
  }

  const normalized = parsed.allowances.map(normalizeAllowance);
  const ids = new Set<string>();
  for (const allowance of normalized) {
    if (ids.has(allowance.id)) {
      throw new Error(`The export contains a duplicate allowance ID: ${allowance.id}.`);
    }
    ids.add(allowance.id);
  }
  return normalized;
}

export function isAllowanceActive(allowance: TokenAllowance): boolean {
  if (BigInt(allowance.amount) === 0n) {
    return false;
  }
  return !(
    allowance.expirationLedger !== null &&
    allowance.observedLedger !== null &&
    allowance.expirationLedger < allowance.observedLedger
  );
}

function formatTokenAmount(amount: string, decimals: number): string {
  const raw = BigInt(amount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fractional = raw % divisor;
  if (fractional === 0n) {
    return whole.toLocaleString('en-US');
  }
  const fraction = fractional.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

export function assessAllowance(allowance: TokenAllowance): AuditedAllowance {
  const amount = BigInt(allowance.amount);
  const isUnlimited = amount === MAX_I128;
  const risk: AllowanceRisk = isUnlimited
    ? 'high'
    : allowance.expirationLedger === null
      ? 'moderate'
      : 'low';

  return {
    ...allowance,
    isUnlimited,
    risk,
    formattedAmount: isUnlimited
      ? 'Unlimited'
      : formatTokenAmount(allowance.amount, allowance.tokenDecimals),
  };
}

export function summarizeAllowances(
  allowances: readonly TokenAllowance[],
): AllowanceAuditSummary {
  const active = allowances.filter(isAllowanceActive).map(assessAllowance);
  const highRiskCount = active.filter((allowance) => allowance.risk === 'high').length;
  const moderateRiskCount = active.filter((allowance) => allowance.risk === 'moderate').length;
  const postureScore = active.length === 0
    ? 100
    : Math.max(0, 100 - highRiskCount * 20 - moderateRiskCount * 8);

  return {
    postureScore,
    activeCount: active.length,
    highRiskCount,
    moderateRiskCount,
  };
}

export function createRevokeReviewBundle(
  allowances: readonly TokenAllowance[],
  selectedIds: readonly string[],
): { owner: string; network: string; allowances: Array<Pick<TokenAllowance, 'id' | 'tokenAddress' | 'spenderAddress'>> } {
  const selected = new Set(selectedIds);
  const activeById = new Map(
    allowances.filter(isAllowanceActive).map((allowance) => [allowance.id, allowance]),
  );
  const entries = selectedIds.map((id) => {
    const allowance = activeById.get(id);
    if (!allowance) {
      throw new Error(`Allowance ${id} is not active in this snapshot.`);
    }
    return allowance;
  });

  if (entries.length === 0) {
    throw new Error('Select at least one active allowance.');
  }

  const owner = entries[0].owner;
  const network = entries[0].network;
  if (entries.some((entry) => entry.owner !== owner || entry.network !== network)) {
    throw new Error('A revoke batch must contain allowances for one owner on one network.');
  }
  if (selected.size !== entries.length) {
    throw new Error('The revoke batch contains duplicate allowance IDs.');
  }

  return {
    owner,
    network,
    allowances: entries.map(({ id, tokenAddress, spenderAddress }) => ({
      id,
      tokenAddress,
      spenderAddress,
    })),
  };
}

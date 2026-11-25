const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type TokenAmountInput = string | bigint;
export const MAX_U128 = (1n << 128n) - 1n;

/** Convert whole Stellar XLM to its exact 7-decimal stroop count. */
export function toStroops(amount: string): bigint {
  return parseUnits(amount, 7);
}

/** Convert a stroop count to a canonical decimal XLM string. */
export function fromStroops(stroops: TokenAmountInput): string {
  return formatUnits(stroops, 7);
}

/** Exact unsigned multiplication followed by floor division. */
export function mulDivFloor(value: bigint, numerator: bigint, denominator: bigint): bigint {
  assertUnsigned(value, "value");
  assertUnsigned(numerator, "numerator");
  assertPositive(denominator, "denominator");
  return value * numerator / denominator;
}

/** Exact unsigned multiplication followed by ceiling division. */
export function mulDivCeil(value: bigint, numerator: bigint, denominator: bigint): bigint {
  assertUnsigned(value, "value");
  assertUnsigned(numerator, "numerator");
  assertPositive(denominator, "denominator");
  const product = value * numerator;
  return (product + denominator - 1n) / denominator;
}
export const STROOPS_DECIMALS = 7;

/** Convert a base-unit integer to a decimal token string without using Number. */
export function formatUnits(value: TokenAmountInput, decimals = STROOPS_DECIMALS): string {
  assertDecimals(decimals);
  const amount = typeof value === "bigint" ? value : parseInteger(value);
  const negative = amount < 0n;
  if (decimals === 0) {
    return `${negative ? "-" : ""}${(negative ? -amount : amount).toString()}`;
  }
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const fraction = digits.slice(-decimals).replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Convert an exact decimal token string to base units. Fractions beyond the precision are rejected. */
export function parseUnits(value: string, decimals = STROOPS_DECIMALS): bigint {
  assertDecimals(decimals);
  const normalized = value.trim();
  if (!DECIMAL_AMOUNT.test(normalized)) {
    throw new Error("Token amount must be a non-negative decimal number");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Token amount supports at most ${decimals} decimal places`);
  }

  const result = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (result > MAX_U128) throw new Error("Token amount exceeds the maximum u128 value");
  return result;
}

/** Validate native token stroop decimal precision and return bigint stroops. */
export function validateStroopAmount(amount: string | bigint, decimals = STROOPS_DECIMALS): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new Error("Stroop amount must be positive");
    }
    return amount;
  }
  const parsed = parseUnits(amount, decimals);
  if (parsed <= 0n) {
    throw new Error("Token amount must be greater than zero");
  }
  return parsed;
}

/** Simulate balance after deposit or withdrawal with minimum balance validation. */
export function simulateMinimumBalanceCheck(
  currentBalanceStroops: bigint,
  amountStroops: bigint,
  isWithdrawal = false,
  minBalanceStroops = 0n
): { valid: boolean; newBalanceStroops: bigint; error?: string } {
  if (amountStroops <= 0n) {
    return { valid: false, newBalanceStroops: currentBalanceStroops, error: "Amount must be positive" };
  }
  if (isWithdrawal) {
    if (currentBalanceStroops < amountStroops) {
      return { valid: false, newBalanceStroops: currentBalanceStroops, error: "Insufficient balance for withdrawal" };
    }
    const newBalance = currentBalanceStroops - amountStroops;
    if (newBalance < minBalanceStroops) {
      return { valid: false, newBalanceStroops: currentBalanceStroops, error: "Withdrawal exceeds minimum balance limit" };
    }
    return { valid: true, newBalanceStroops: newBalance };
  } else {
    const newBalance = currentBalanceStroops + amountStroops;
    return { valid: true, newBalanceStroops: newBalance };
  }
}

/** True when a form value can be submitted as an exact base-unit integer. */
export function isExactTokenAmount(value: string, decimals = STROOPS_DECIMALS): boolean {
  try {
    parseUnits(value, decimals);
    return true;
  } catch {
    return false;
  }
}

function parseInteger(value: string): bigint {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new Error("Base-unit token amount must be an integer");
  }
  return BigInt(value);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Token decimals must be a non-negative integer");
  }
}

function assertUnsigned(value: bigint, name: string): void {
  if (value < 0n || value > MAX_U128) throw new Error(`${name} must fit in unsigned u128`);
}

function assertPositive(value: bigint, name: string): void {
  if (value <= 0n || value > MAX_U128) throw new Error(`${name} must be a positive u128`);
}

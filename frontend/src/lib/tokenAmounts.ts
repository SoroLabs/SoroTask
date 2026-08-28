const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type TokenAmountInput = string | bigint;

/** Convert a base-unit integer to a decimal token string without using Number. */
export function formatUnits(value: TokenAmountInput, decimals = 7): string {
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
export function parseUnits(value: string, decimals = 7): bigint {
  assertDecimals(decimals);
  const normalized = value.trim();
  if (!DECIMAL_AMOUNT.test(normalized)) {
    throw new Error("Token amount must be a non-negative decimal number");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Token amount supports at most ${decimals} decimal places`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** True when a form value can be submitted as an exact base-unit integer. */
export function isExactTokenAmount(value: string, decimals = 7): boolean {
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
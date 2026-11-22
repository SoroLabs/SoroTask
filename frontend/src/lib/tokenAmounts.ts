const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type TokenAmountInput = string | bigint;

export type SupportedCurrency = "XLM" | "USDC" | "EURC" | "BTC" | "ETH";

export interface ExchangeRates {
  XLM: number;
  USDC: number;
  EURC: number;
  BTC: number;
  ETH: number;
}

export const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
  XLM: 1.0,
  USDC: 0.12,
  EURC: 0.11,
  BTC: 0.00000125,
  ETH: 0.000035,
};

let ratesCache: { data: ExchangeRates; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30s TTL as per acceptance criteria

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

  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
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

/**
 * Fetch live exchange rates from Stellar DEX / Oracles with 30s SWR TTL caching.
 */
export async function getLiveExchangeRates(forceRefresh = false): Promise<ExchangeRates> {
  const now = Date.now();
  if (!forceRefresh && ratesCache && now - ratesCache.timestamp < CACHE_TTL_MS) {
    return ratesCache.data;
  }

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd,eur,btc,eth", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const data = await res.json();
      const stellar = data.stellar;
      if (stellar) {
        const rates: ExchangeRates = {
          XLM: 1.0,
          USDC: Number(stellar.usd) || DEFAULT_EXCHANGE_RATES.USDC,
          EURC: Number(stellar.eur) || DEFAULT_EXCHANGE_RATES.EURC,
          BTC: Number(stellar.btc) || DEFAULT_EXCHANGE_RATES.BTC,
          ETH: Number(stellar.eth) || DEFAULT_EXCHANGE_RATES.ETH,
        };
        ratesCache = { data: rates, timestamp: now };
        return rates;
      }
    }
  } catch {
    // Fallback gracefully on timeout or network error
  }

  ratesCache = { data: DEFAULT_EXCHANGE_RATES, timestamp: now };
  return DEFAULT_EXCHANGE_RATES;
}

/**
 * Convert an amount in XLM / Stroops to target currency.
 */
export function convertXlmAmount(
  xlmAmount: number | string | bigint,
  targetCurrency: SupportedCurrency,
  rates: ExchangeRates = DEFAULT_EXCHANGE_RATES
): number {
  const numericXlm =
    typeof xlmAmount === "bigint"
      ? Number(xlmAmount) / 10_000_000
      : typeof xlmAmount === "string"
      ? parseFloat(xlmAmount) || 0
      : xlmAmount;

  if (targetCurrency === "XLM") return numericXlm;

  const rate = rates[targetCurrency] ?? 1.0;
  return numericXlm * rate;
}

/**
 * Formats a currency valuation respecting regional conventions.
 */
export function formatRegionalCurrency(
  value: number,
  currency: SupportedCurrency,
  locale = "en-US"
): string {
  try {
    if (currency === "USDC") {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value) + " (USDC)";
    }

    if (currency === "EURC") {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value) + " (EURC)";
    }

    if (currency === "BTC") {
      return `₿ ${value.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}`;
    }

    if (currency === "ETH") {
      return `Ξ ${value.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 5,
      })}`;
    }

    // Default XLM
    return `${value.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })} XLM`;
  } catch {
    return `${value.toFixed(4)} ${currency}`;
  }
}

import type {
  FinancialRecord,
  FinancialSeriesKind,
  GasFeeCandle,
  LiquidityDepthLevel,
} from "./types";

const MAX_HISTORY_RECORDS = 10_000;

export function getHistoryUrl(kind: FinancialSeriesKind): string {
  const configuredBase = process.env.NEXT_PUBLIC_ANALYTICS_API_URL;
  const base = configuredBase?.replace(/\/+$/, "");
  const apiPrefix = base?.endsWith("/api") ? "/analytics" : "/api/analytics";
  const path = `${apiPrefix}/${kind}-history`;
  if (!configuredBase) return path;

  return `${base}${path}`;
}

export function getWebSocketUrl(kind: FinancialSeriesKind): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_ANALYTICS_WS_URL?.trim();
  if (!configuredUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_ANALYTICS_WS_URL must be a valid absolute WebSocket URL.");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("NEXT_PUBLIC_ANALYTICS_WS_URL must use ws:// or wss://.");
  }
  parsed.searchParams.set("stream", kind);
  return parsed.toString();
}

export function parseHistoryResponse(
  payload: unknown,
  kind: FinancialSeriesKind,
): FinancialRecord[] {
  const records = Array.isArray(payload)
    ? payload
    : payload !== null &&
        typeof payload === "object" &&
        "records" in payload &&
        Array.isArray(payload.records)
      ? payload.records
      : null;

  if (!records) {
    throw new Error("Analytics history response must be an array or an object with a records array.");
  }
  if (records.length > MAX_HISTORY_RECORDS) {
    throw new Error(`Analytics history exceeds the ${MAX_HISTORY_RECORDS}-record limit.`);
  }

  return records.map((record, index) => parseRecord(record, kind, index));
}

export function parseSocketMessage(
  payload: unknown,
  kind: FinancialSeriesKind,
): FinancialRecord | null {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Analytics WebSocket message must be an object.");
  }

  const message = payload as Record<string, unknown>;
  if (message.type === "heartbeat") return null;
  if (message.type !== kind) {
    throw new Error(`Unexpected analytics WebSocket message type "${String(message.type)}".`);
  }
  return parseRecord(message.data, kind, 0);
}

export function mergeRecords<T extends FinancialRecord>(
  existing: T[],
  incoming: T[],
  limit = MAX_HISTORY_RECORDS,
): T[] {
  const byTimestamp = new Map(existing.map((record) => [record.timestamp, record]));
  for (const record of incoming) byTimestamp.set(record.timestamp, record);
  return [...byTimestamp.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-limit);
}

function parseRecord(
  value: unknown,
  kind: FinancialSeriesKind,
  index: number,
): FinancialRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Analytics record ${index + 1} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const timestamp = normalizeTimestamp(record.timestamp);
  if (kind === "yield") {
    const apyPercent = finiteNonNegative(record.apyPercent, `record ${index + 1} apyPercent`);
    const accruedYieldXlm =
      record.accruedYieldXlm === undefined
        ? undefined
        : finiteNonNegative(record.accruedYieldXlm, `record ${index + 1} accruedYieldXlm`);
    return { timestamp, apyPercent, accruedYieldXlm };
  }

  const open = finiteNonNegative(record.open, `record ${index + 1} open`);
  const high = finiteNonNegative(record.high, `record ${index + 1} high`);
  const low = finiteNonNegative(record.low, `record ${index + 1} low`);
  const close = finiteNonNegative(record.close, `record ${index + 1} close`);
  if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
    throw new Error(`Analytics record ${index + 1} has inconsistent OHLC values.`);
  }

  const candle: GasFeeCandle = {
    timestamp,
    open,
    high,
    low,
    close,
  };
  if (record.volumeXlm !== undefined) {
    candle.volumeXlm = finiteNonNegative(record.volumeXlm, `record ${index + 1} volumeXlm`);
  }
  if (record.batchSavingsXlm !== undefined) {
    candle.batchSavingsXlm = finiteNonNegative(
      record.batchSavingsXlm,
      `record ${index + 1} batchSavingsXlm`,
    );
  }
  if (record.depth !== undefined) candle.depth = parseDepth(record.depth, index);
  return candle;
}

function parseDepth(value: unknown, recordIndex: number): LiquidityDepthLevel[] {
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new Error(`Analytics record ${recordIndex + 1} depth must be an array of at most 5,000 levels.`);
  }
  return value.map((level, index) => {
    if (level === null || typeof level !== "object" || Array.isArray(level)) {
      throw new Error(`Analytics record ${recordIndex + 1} depth level ${index + 1} must be an object.`);
    }
    const item = level as Record<string, unknown>;
    return {
      priceXlm: finiteNonNegative(item.priceXlm, `record ${recordIndex + 1} depth priceXlm`),
      cumulativeVolumeXlm: finiteNonNegative(
        item.cumulativeVolumeXlm,
        `record ${recordIndex + 1} depth cumulativeVolumeXlm`,
      ),
    };
  });
}

function normalizeTimestamp(value: unknown): string {
  const timestamp =
    typeof value === "number"
      ? new Date(value < 1_000_000_000_000 ? value * 1_000 : value)
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    throw new Error("Analytics record timestamp must be a valid ISO date or Unix timestamp.");
  }
  return timestamp.toISOString();
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Analytics ${label} must be a finite non-negative number.`);
  }
  return value;
}

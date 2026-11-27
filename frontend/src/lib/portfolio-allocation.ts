/** Read-only valuation snapshots. USD cents are strings to preserve exact totals. */
export interface PortfolioAsset {
  assetId: string;
  symbol: string;
  name: string;
  activeUsdCents: string;
  idleUsdCents: string;
}

export interface PortfolioSnapshot {
  schemaVersion: 1;
  address: string;
  networkPassphrase: string;
  asOf: string;
  assets: PortfolioAsset[];
  history: { at: string; totalUsdCents: string }[];
}

export interface AllocationRow extends PortfolioAsset {
  totalCents: bigint;
  share: number;
  color: string;
}

export interface AllocationSlice {
  assetId: string;
  name: string;
  symbol: string;
  totalCents: bigint;
  activeCents: bigint;
  idleCents: bigint;
  share: number;
  color: string;
}

const MAX_CENTS = (1n << 127n) - 1n;
export const MAX_PORTFOLIO_ASSETS = 200;
export const MAX_HISTORY_POINTS = 365;
// Okabe–Ito colors; labels, percentages and a table provide non-color cues.
export const ALLOCATION_COLORS = ["#56B4E9", "#E69F00", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid portfolio snapshot");
  return value as Record<string, unknown>;
}

function label(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Invalid portfolio label");
  }
  return value.trim();
}

function cents(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,38})$/.test(value) || BigInt(value) > MAX_CENTS) {
    throw new Error("Invalid portfolio valuation");
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("Invalid portfolio timestamp");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z")) {
    throw new Error("Invalid portfolio timestamp");
  }
  return date.toISOString();
}

export function parsePortfolioSnapshot(raw: unknown, scope?: { address: string; networkPassphrase: string }): PortfolioSnapshot {
  const data = object(raw);
  if (data.schemaVersion !== 1) throw new Error("Unsupported portfolio snapshot");
  const address = label(data.address, 56);
  if (!/^G[A-Z2-7]{55}$/.test(address)) throw new Error("Invalid portfolio address");
  const networkPassphrase = label(data.networkPassphrase, 100);
  if (scope && (address !== scope.address || networkPassphrase !== scope.networkPassphrase)) {
    throw new Error("Portfolio scope mismatch");
  }
  const asOf = timestamp(data.asOf);
  if (!Array.isArray(data.assets) || data.assets.length > MAX_PORTFOLIO_ASSETS
    || !Array.isArray(data.history) || data.history.length > MAX_HISTORY_POINTS) throw new Error("Invalid portfolio size");
  const seen = new Set<string>();
  let total = 0n;
  const assets = data.assets.map((value): PortfolioAsset => {
    const asset = object(value);
    const assetId = label(asset.assetId, 160);
    if (seen.has(assetId)) throw new Error("Duplicate portfolio asset");
    seen.add(assetId);
    const activeUsdCents = cents(asset.activeUsdCents);
    const idleUsdCents = cents(asset.idleUsdCents);
    total += BigInt(activeUsdCents) + BigInt(idleUsdCents);
    if (total > MAX_CENTS) throw new Error("Portfolio total exceeds supported range");
    return { assetId, symbol: label(asset.symbol, 32), name: label(asset.name, 100), activeUsdCents, idleUsdCents };
  });
  const times = new Set<string>();
  const history = data.history.map((value) => {
    const point = object(value);
    const at = timestamp(point.at);
    if (times.has(at) || at > asOf) throw new Error("Invalid portfolio history");
    times.add(at);
    return { at, totalUsdCents: cents(point.totalUsdCents) };
  }).sort((a, b) => a.at.localeCompare(b.at));
  return { schemaVersion: 1, address, networkPassphrase, asOf, assets, history };
}

export function formatUsdCents(amount: bigint | string): string {
  const value = BigInt(amount);
  return `$${new Intl.NumberFormat("en-US").format(value / 100n)}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function formatShare(share: number): string {
  return share > 0 && share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;
}

function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ALLOCATION_COLORS[hash % ALLOCATION_COLORS.length];
}

export function buildAllocation(snapshot: PortfolioSnapshot) {
  const totalCents = snapshot.assets.reduce((total, asset) => total + BigInt(asset.activeUsdCents) + BigInt(asset.idleUsdCents), 0n);
  const activeCents = snapshot.assets.reduce((total, asset) => total + BigInt(asset.activeUsdCents), 0n);
  const rows: AllocationRow[] = snapshot.assets.map((asset) => {
    const total = BigInt(asset.activeUsdCents) + BigInt(asset.idleUsdCents);
    return { ...asset, totalCents: total, share: totalCents ? Number(total) / Number(totalCents) : 0, color: colorFor(asset.assetId) };
  }).sort((a, b) => a.totalCents === b.totalCents ? a.assetId.localeCompare(b.assetId) : a.totalCents > b.totalCents ? -1 : 1);
  const funded = rows.filter((row) => row.totalCents > 0n);
  const visible = funded.length > 8 ? funded.slice(0, 7) : funded;
  const slices: AllocationSlice[] = visible.map((row) => ({ ...row, activeCents: BigInt(row.activeUsdCents), idleCents: BigInt(row.idleUsdCents) }));
  const remaining = funded.slice(visible.length);
  if (remaining.length) {
    const remainder = remaining.reduce((total, row) => total + row.totalCents, 0n);
    const active = remaining.reduce((total, row) => total + BigInt(row.activeUsdCents), 0n);
    slices.push({ assetId: "__other_assets__", name: `${remaining.length} other assets`, symbol: "Other assets",
      totalCents: remainder, activeCents: active, idleCents: remainder - active, share: Number(remainder) / Number(totalCents), color: "#94A3B8" });
  }
  return { rows, slices, totalCents, activeCents, idleCents: totalCents - activeCents };
}

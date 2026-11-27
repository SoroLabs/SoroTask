import { buildAllocation, formatShare, formatUsdCents, parsePortfolioSnapshot } from "../portfolio-allocation";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const networkPassphrase = "Test SDF Future Network ; October 2022";
const asset = (assetId = "USDC:issuer", extra = {}) => ({ assetId, symbol: "USDC", name: "USD Coin", activeUsdCents: "6000", idleUsdCents: "4000", ...extra });
const snapshot = (extra = {}) => ({ schemaVersion: 1, address, networkPassphrase, asOf: "2026-11-23T10:00:00Z", assets: [asset()], history: [], ...extra });

describe("portfolio allocation values", () => {
  it("keeps exact cents and active/idle conservation above Number precision", () => {
    const data = parsePortfolioSnapshot(snapshot({ assets: [asset("one", { activeUsdCents: "9007199254740993", idleUsdCents: "7" }), asset("two")] }));
    const model = buildAllocation(data);
    expect(model.totalCents).toBe(9007199254751000n);
    expect(model.activeCents + model.idleCents).toBe(model.totalCents);
    expect(formatUsdCents("9007199254740993")).toBe("$90,071,992,547,409.93");
    expect(model.slices.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
  });

  it("groups dozens of assets while retaining every exact row and stable colors", () => {
    const assets = Array.from({ length: 30 }, (_, i) => asset(`asset-${i}`, { activeUsdCents: String(i + 1), idleUsdCents: "0" }));
    const model = buildAllocation(parsePortfolioSnapshot(snapshot({ assets })));
    expect(model.slices).toHaveLength(8);
    expect(model.rows).toHaveLength(30);
    expect(model.slices[7].name).toBe("23 other assets");
    expect(model.slices.reduce((sum, row) => sum + row.totalCents, 0n)).toBe(model.totalCents);
    const reversed = buildAllocation(parsePortfolioSnapshot(snapshot({ assets: [...assets].reverse() })));
    expect(reversed.rows).toEqual(model.rows);
  });

  it("preserves asset identity for equal symbols and zero balances", () => {
    const model = buildAllocation(parsePortfolioSnapshot(snapshot({ assets: [asset("issuer1"), asset("issuer2"), asset("zero", { activeUsdCents: "0", idleUsdCents: "0" })] })));
    expect(model.rows).toHaveLength(3);
    expect(model.slices).toHaveLength(2);
    expect(model.rows[2].share).toBe(0);
    expect(buildAllocation(parsePortfolioSnapshot(snapshot({ assets: [] }))).totalCents).toBe(0n);
    expect(formatShare(0.000001)).toBe("<0.1%");
    expect(formatShare(0.6)).toBe("60.0%");
  });

  it("canonicalizes and sorts history without mutating input", () => {
    const raw = snapshot({ history: [{ at: "2026-11-22T00:00:00Z", totalUsdCents: "50" }, { at: "2026-11-21T00:00:00Z", totalUsdCents: "20" }] });
    const before = JSON.stringify(raw);
    const parsed = parsePortfolioSnapshot(raw, { address, networkPassphrase });
    expect(parsed.history[0].at).toBe("2026-11-21T00:00:00.000Z");
    expect(JSON.stringify(raw)).toBe(before);
    expect(parsed.asOf).toBe("2026-11-23T10:00:00.000Z");
  });

  it.each([null, [], {}, snapshot({ schemaVersion: 2 }), snapshot({ address: "bad" }), snapshot({ networkPassphrase: "" }), snapshot({ assets: {} }), snapshot({ history: {} })])("rejects invalid snapshot boundaries %#", (raw) => {
    expect(() => parsePortfolioSnapshot(raw)).toThrow();
  });

  it.each(["-1", "01", "1.5", "NaN", "", 100, true, "170141183460469231731687303715884105728"])("rejects invalid valuation %s", (value) => {
    expect(() => parsePortfolioSnapshot(snapshot({ assets: [asset("one", { activeUsdCents: value })] }))).toThrow();
  });

  it("rejects overflow across otherwise valid assets", () => {
    expect(() => parsePortfolioSnapshot(snapshot({ assets: [asset("one", { activeUsdCents: ((1n << 127n) - 1n).toString(), idleUsdCents: "1" })] }))).toThrow();
  });

  it("rejects mismatched owner/network, duplicate assets and invalid labels", () => {
    expect(() => parsePortfolioSnapshot(snapshot(), { address: "different", networkPassphrase })).toThrow("scope mismatch");
    expect(() => parsePortfolioSnapshot(snapshot(), { address, networkPassphrase: "different" })).toThrow("scope mismatch");
    expect(() => parsePortfolioSnapshot(snapshot({ assets: [asset(), asset()] }))).toThrow("Duplicate");
    for (const bad of ["", "\u0001", "x".repeat(101)]) expect(() => parsePortfolioSnapshot(snapshot({ assets: [asset("one", { name: bad })] }))).toThrow();
  });

  it.each(["2026-02-30T00:00:00Z", "2026-11-23", "2026-11-23T00:00:00", "2026-11-23T25:00:00Z"])("rejects invalid as-of %s", (asOf) => {
    expect(() => parsePortfolioSnapshot(snapshot({ asOf }))).toThrow();
  });

  it("rejects duplicate/future history and oversized datasets", () => {
    const point = { at: "2026-11-22T00:00:00Z", totalUsdCents: "1" };
    expect(() => parsePortfolioSnapshot(snapshot({ history: [point, point] }))).toThrow();
    expect(() => parsePortfolioSnapshot(snapshot({ history: [{ ...point, at: "2026-11-24T00:00:00Z" }] }))).toThrow();
    expect(() => parsePortfolioSnapshot(snapshot({ assets: Array.from({ length: 201 }, (_, i) => asset(String(i))) }))).toThrow();
    expect(() => parsePortfolioSnapshot(snapshot({ history: Array(366).fill(point) }))).toThrow();
  });
});

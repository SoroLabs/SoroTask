import {
  formatUnits,
  parseUnits,
  convertXlmAmount,
  formatRegionalCurrency,
  getLiveExchangeRates,
  DEFAULT_EXCHANGE_RATES,
} from "../tokenAmounts";

describe("tokenAmounts multi-currency valuation", () => {
  it("formats units correctly with decimals", () => {
    expect(formatUnits("10000000", 7)).toBe("1");
    expect(formatUnits(10000000n, 7)).toBe("1");
    expect(formatUnits("15000000", 7)).toBe("1.5");
  });

  it("parses units accurately to BigInt", () => {
    expect(parseUnits("1", 7)).toBe(10000000n);
    expect(parseUnits("0.5", 7)).toBe(5000000n);
  });

  it("converts XLM amounts according to exchange rates", () => {
    const customRates = {
      XLM: 1.0,
      USDC: 0.15,
      EURC: 0.14,
      BTC: 0.000002,
      ETH: 0.00004,
    };

    expect(convertXlmAmount(100, "XLM", customRates)).toBe(100);
    expect(convertXlmAmount(100, "USDC", customRates)).toBe(15);
    expect(convertXlmAmount(100, "EURC", customRates)).toBe(14);
  });

  it("formats regional currency amounts correctly", () => {
    const formattedUsdc = formatRegionalCurrency(25.5, "USDC", "en-US");
    expect(formattedUsdc).toContain("25.50");
    expect(formattedUsdc).toContain("USDC");

    const formattedXlm = formatRegionalCurrency(100, "XLM", "en-US");
    expect(formattedXlm).toContain("100");
    expect(formattedXlm).toContain("XLM");
  });

  it("fetches live exchange rates with fallback", async () => {
    const rates = await getLiveExchangeRates();
    expect(rates).toBeDefined();
    expect(rates.XLM).toBe(1.0);
    expect(typeof rates.USDC).toBe("number");
  });
});

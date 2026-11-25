import { DICTIONARIES, formatStellarBalance, SupportedLocale } from "../translations";

describe("i18n Translation & Stellar Formatting Engine", () => {
  it("provides complete translations for all supported locales", () => {
    const locales: SupportedLocale[] = ["en", "es", "zh", "fr"];
    for (const loc of locales) {
      expect(DICTIONARIES[loc].appName).toBeDefined();
      expect(DICTIONARIES[loc].createTask).toBeDefined();
      expect(DICTIONARIES[loc].balance).toBeDefined();
    }
  });

  it("formats stroops into formatted XLM string correctly", () => {
    const formatted = formatStellarBalance(100_000_000, "en"); // 10 XLM
    expect(formatted).toBe("10.00 XLM");

    const fractional = formatStellarBalance(12_345_678, "en");
    expect(fractional).toBe("1.2345678 XLM");
  });
});

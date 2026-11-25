/**
 * Asynchronous dictionary loading and locale-aware formatting (#1242).
 */

import {
  loadDictionary,
  isLocaleLoaded,
  preloadLocales,
  resetDictionaryCache,
  __setLoaderForTesting,
} from "@/i18n/loader";
import {
  formatXlm,
  formatStroops,
  toIntlLocale,
  toBigInt,
  formatNumber,
  formatGasBalance,
  getTextDirection,
  isRtlLocale,
  getTextExpansionFactor,
  getFontAdjustments,
  formatInterval,
  STROOPS_PER_XLM,
} from "@/i18n/formatting";
import {
  SUPPORTED_LOCALES,
  getAvailableLocales,
  hasTranslation,
  getTranslation,
} from "@/i18n/index";

afterEach(() => {
  resetDictionaryCache();
});

describe("dictionary loading", () => {
  it("resolves the default locale without any dynamic import", async () => {
    const dictionary = await loadDictionary("en");
    expect(dictionary).toHaveProperty("common");
    expect(isLocaleLoaded("en")).toBe(true);
  });

  it("loads a real non-default locale", async () => {
    const dictionary = await loadDictionary("es");
    expect((dictionary as { common: { cancel: string } }).common.cancel).toBe(
      "Cancelar",
    );
  });

  it("memoises so a second call does not re-import", async () => {
    await loadDictionary("fr");
    const loader = jest.fn().mockResolvedValue({ default: { common: {} } });
    __setLoaderForTesting("de", loader);
    resetDictionaryCache();
    await loadDictionary("de");
    await loadDictionary("de");
    expect(loader).toHaveBeenCalledTimes(1);
    __setLoaderForTesting("de", null);
  });

  it("shares one request between concurrent callers", async () => {
    const loader = jest.fn().mockResolvedValue({ default: { common: {} } });
    __setLoaderForTesting("pt", loader);
    resetDictionaryCache();

    await Promise.all([
      loadDictionary("pt"),
      loadDictionary("pt"),
      loadLocale("pt"),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    __setLoaderForTesting("pt", null);
  });

  it("falls back to English when a chunk fails to load", async () => {
    const loader = jest.fn().mockRejectedValue(new Error("chunk 404"));
    __setLoaderForTesting("zh", loader);
    resetDictionaryCache();

    // A network blip must degrade to English, not reject and blank the page.
    const dictionary = await loadDictionary("zh");
    expect(dictionary).toHaveProperty("common");
    expect(isLocaleLoaded("zh")).toBe(false);
    __setLoaderForTesting("zh", null);
  });

  it("allows a retry after a failed load", async () => {
    const loader = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ default: { common: { cancel: "Abbrechen" } } });
    __setLoaderForTesting("de", loader);
    resetDictionaryCache();

    await loadDictionary("de");
    const second = await loadDictionary("de");
    expect((second as { common: { cancel: string } }).common.cancel).toBe(
      "Abbrechen",
    );
    expect(loader).toHaveBeenCalledTimes(2);
    __setLoaderForTesting("de", null);
  });

  it("preloads several locales without rejecting", async () => {
    await expect(preloadLocales(["es", "fr", "ar"])).resolves.toBeUndefined();
    expect(isLocaleLoaded("ar")).toBe(true);
  });
});

function loadLocale(locale: Parameters<typeof loadDictionary>[0]) {
  return loadDictionary(locale);
}

describe("XLM and stroop formatting", () => {
  it("appends the currency code rather than relying on Intl to know XLM", () => {
    expect(formatXlm(1234.5, "en")).toBe("1,234.5 XLM");
  });

  it("caps fraction digits at the on-chain precision", () => {
    expect(formatXlm(1.123456789, "en", 7)).toBe("1.1234568 XLM");
    expect(formatXlm(1.123456789, "en", 2)).toBe("1.12 XLM");
  });

  it("renders a placeholder for a non-finite amount", () => {
    expect(formatXlm(NaN, "en")).toBe("—");
  });

  it("converts stroops to XLM exactly", () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000);
    expect(formatStroops(10_000_000, "en")).toBe("1 XLM");
    expect(formatStroops(15_000_000, "en")).toBe("1.5 XLM");
  });

  it("trims trailing zeros in the stroop fraction", () => {
    expect(formatStroops(1_000_000, "en")).toBe("0.1 XLM");
    expect(formatStroops(1, "en")).toBe("0.0000001 XLM");
    expect(formatStroops(0, "en")).toBe("0 XLM");
  });

  it("keeps full precision for values beyond Number.MAX_SAFE_INTEGER", () => {
    // The whole reason the conversion is done on a string/BigInt.
    const huge = "12345678901234567890";
    expect(formatStroops(huge, "en")).toBe("1234567890123.456789 XLM");
  });

  it("handles negative stroop amounts", () => {
    expect(formatStroops(-15_000_000, "en")).toBe("-1.5 XLM");
  });

  it("rejects a fractional stroop value, which cannot come from a u64", () => {
    expect(toBigInt(1.5)).toBeNull();
    expect(formatStroops(1.5, "en")).toBe("—");
    expect(formatStroops("not-a-number", "en")).toBe("—");
  });

  it("uses each locale's own number formatting", () => {
    // This is the bug that was silently present: `pt` was missing from the
    // locale table, so Portuguese fell through to String(value).
    expect(toIntlLocale("pt")).toBe("pt-BR");
    expect(formatNumber(1234.5, "pt")).not.toBe("1234.5");
    expect(formatXlm(1234.5, "pt")).toContain("XLM");
  });

  it("covers every supported locale in the Intl table", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(toIntlLocale(locale)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      // None of these should throw for any shipped locale.
      expect(() => formatNumber(1000, locale)).not.toThrow();
      expect(() => formatGasBalance(1.5, locale)).not.toThrow();
      expect(() => formatInterval(3600, locale)).not.toThrow();
      expect(getTextExpansionFactor(locale)).toBeGreaterThan(0);
      expect(getFontAdjustments(locale).lineHeight).toBeGreaterThan(0);
    }
  });
});

describe("right-to-left support", () => {
  it("marks Arabic as RTL and everything else as LTR", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(getTextDirection("ar")).toBe("rtl");
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== "ar")) {
      expect(getTextDirection(locale)).toBe("ltr");
    }
  });

  it("exposes the direction on every available locale so the picker can use it", () => {
    const arabic = getAvailableLocales().find((l) => l.code === "ar");
    expect(arabic?.direction).toBe("rtl");
    expect(getAvailableLocales().find((l) => l.code === "en")?.direction).toBe(
      "ltr",
    );
  });

  it("provides a native name for every locale", () => {
    for (const entry of getAvailableLocales()) {
      expect(entry.nativeName).toBeTruthy();
    }
  });
});

describe("catalogue integrity", () => {
  // Scoped to the `language.*` namespace, which this change owns. Keys for the
  // offline bar, the theme toggle and the template gallery are introduced by
  // their own changes and asserted there, so this suite stays green whichever
  // subset of them has landed.
  const required = ["language.label", "language.loading", "language.available"];

  it("defines the language-picker keys in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of required) {
        expect({ locale, key, present: hasTranslation(locale, key) }).toEqual({
          locale,
          key,
          present: true,
        });
      }
    }
  });

  it("renders a plural string for 0, 1 and many in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const count of [0, 1, 2, 11]) {
        const text = getTranslation(locale, "language.available", { count });
        expect(text).not.toContain("{count");
        expect(text).not.toBe("language.available");
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("picks a different plural branch per locale for the same count", () => {
    // The whole point of moving off suffix concatenation: the same key, the
    // same count, different language, different branch.
    const english = getTranslation("en", "language.available", { count: 0 });
    const french = getTranslation("fr", "language.available", { count: 0 });
    expect(english).not.toBe(french);
  });

  it("returns the key path when nothing resolves", () => {
    expect(getTranslation("en", "nope.missing.key")).toBe("nope.missing.key");
    expect(hasTranslation("en", "nope.missing.key")).toBe(false);
  });
});

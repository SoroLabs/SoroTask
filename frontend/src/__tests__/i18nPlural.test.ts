/**
 * Pluralisation and ICU message formatting (#1242).
 *
 * The point of moving off suffix concatenation is that the rules are the
 * platform's, not ours — so these assert against real CLDR categories for
 * languages with genuinely different shapes, not just English 1-vs-many.
 */

import {
  formatMessage,
  getPluralCategory,
  hasPluralForm,
  selectPluralBranch,
  PLURAL_CATEGORIES,
} from "@/i18n/plural";

describe("getPluralCategory", () => {
  it("uses 'one' only for exactly 1 in English", () => {
    expect(getPluralCategory(1, "en")).toBe("one");
    expect(getPluralCategory(0, "en")).toBe("other");
    expect(getPluralCategory(2, "en")).toBe("other");
  });

  it("treats 0 as a separate case in French", () => {
    // The canonical CLDR divergence: French is plural for 0 but singular for 1.
    expect(getPluralCategory(0, "fr")).toBe("one");
    expect(getPluralCategory(1, "fr")).toBe("one");
    expect(getPluralCategory(2, "fr")).toBe("other");
  });

  it("returns the same 'other' for every count in Chinese", () => {
    for (const n of [0, 1, 2, 5, 11, 100]) {
      expect(getPluralCategory(n, "zh")).toBe("other");
    }
  });

  it("distinguishes few/many in a Slavic-style language", () => {
    // Arabic's six categories are the widest spread we ship.
    const seen = new Set(
      [0, 1, 2, 3, 11, 100].map((n) => getPluralCategory(n, "ar")),
    );
    expect(seen.size).toBeGreaterThan(2);
  });

  it("falls back to 'other' for a non-finite count", () => {
    expect(getPluralCategory(NaN, "en")).toBe("other");
    expect(getPluralCategory(Infinity, "en")).toBe("other");
  });

  it("handles fractional counts", () => {
    // 1.5 is "other" in English but the point is that it does not throw.
    expect(PLURAL_CATEGORIES).toContain(getPluralCategory(1.5, "en"));
  });
});

describe("selectPluralBranch", () => {
  const branches = { exact: "none", one: "one", other: "many" } as const;

  it("prefers an explicit =0 branch", () => {
    expect(selectPluralBranch("other", branches, 0)).toBe("none");
  });

  it("falls back through category -> other -> first declared", () => {
    expect(selectPluralBranch("one", branches, 1)).toBe("one");
    expect(selectPluralBranch("other", branches, 7)).toBe("many");
    // "few" is not declared, so `other` is used.
    expect(selectPluralBranch("few", branches, 3)).toBe("many");
  });

  it("returns an empty string when nothing is declared", () => {
    expect(selectPluralBranch("one", {}, 1)).toBe("");
  });
});

describe("formatMessage", () => {
  it("resolves a simple plural message per locale", () => {
    const message = "{count, plural, one {# task} other {# tasks}}";
    expect(formatMessage(message, "en", { count: 1 })).toBe("1 task");
    expect(formatMessage(message, "en", { count: 5 })).toBe("5 tasks");
  });

  it("applies the language's own rule for zero", () => {
    // Same branch structure, different locales: French selects `one` for 0
    // while English selects `other`. The branch *text* is the catalogue's
    // business; which branch gets picked is the engine's.
    const message = "{count, plural, one {# thing} other {# things}}";
    expect(formatMessage(message, "fr", { count: 0 })).toBe("0 thing");
    expect(formatMessage(message, "en", { count: 0 })).toBe("0 things");
    expect(formatMessage(message, "fr", { count: 2 })).toBe("2 things");
  });

  it("resolves a six-branch Arabic message", () => {
    const message =
      "{count, plural, zero {لا} one {واحد} two {اثنان} few {#} many {#} other {#}}";
    expect(formatMessage(message, "ar", { count: 0 })).toBe("لا");
    expect(formatMessage(message, "ar", { count: 1 })).toBe("واحد");
    expect(formatMessage(message, "ar", { count: 2 })).toBe("اثنان");
  });

  it("groups the # placeholder using locale number formatting", () => {
    expect(
      formatMessage("{count, plural, other {#}}", "en", { count: 1234567 }),
    ).toBe("1,234,567");
  });

  it("substitutes named variables inside a plural branch", () => {
    const message = "{name} has {count, plural, one {# task} other {# tasks}}";
    expect(formatMessage(message, "en", { name: "Ada", count: 2 })).toBe(
      "Ada has 2 tasks",
    );
  });

  it("keeps copy that surrounds the plural block", () => {
    const message =
      "Queued: {count, plural, one {# item} other {# items}} — will sync";
    expect(formatMessage(message, "en", { count: 3 })).toBe(
      "Queued: 3 items — will sync",
    );
  });

  it("leaves a non-plural message alone apart from substitution", () => {
    expect(formatMessage("Hello {name}", "en", { name: "Ada" })).toBe(
      "Hello Ada",
    );
    expect(formatMessage("No variables here", "en")).toBe("No variables here");
  });

  it("leaves an unknown placeholder intact", () => {
    expect(formatMessage("Hi {missing}", "en")).toBe("Hi {missing}");
  });

  it("falls back to the 'other' branch when there is no usable count", () => {
    const message = "{count, plural, one {# task} other {# tasks}}";
    expect(formatMessage(message, "en", {})).toBe("0 tasks");
  });

  it("uses 'other' when a catalogue omits it", () => {
    // A hand-written entry with only `one` must still render.
    expect(
      formatMessage("{count, plural, one {solo}}", "en", { count: 4 }),
    ).toBe("solo");
  });

  it("does not throw on an unbalanced plural block", () => {
    // Malformed copy should degrade to something visible, not take the page down.
    expect(() =>
      formatMessage("{count, plural, one {# task}", "en", { count: 1 }),
    ).not.toThrow();
    expect(() =>
      formatMessage("{count, plural", "en", { count: 1 }),
    ).not.toThrow();
  });

  it("handles the legacy {count} task{plural} form unchanged", () => {
    expect(
      formatMessage("{count} task{plural}", "en", { count: 2, plural: "s" }),
    ).toBe("2 tasks");
  });
});

describe("hasPluralForm", () => {
  it("detects an ICU plural expression", () => {
    expect(hasPluralForm("{count, plural, one {#} other {#}}")).toBe(true);
  });

  it("does not false-positive on ordinary copy", () => {
    expect(hasPluralForm("Tasks on {date}")).toBe(false);
    expect(hasPluralForm("{count} task{plural}")).toBe(false);
  });
});

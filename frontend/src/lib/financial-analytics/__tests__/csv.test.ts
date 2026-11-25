import { toCsv } from "../csv";

describe("financial analytics CSV export", () => {
  it("exports every row and escapes commas, quotes and line breaks", () => {
    expect(
      toCsv([
        { recordType: "gas", timestamp: "2026-10-17T00:00:00Z", closeXlm: 0.12 },
        { recordType: "yield", timestamp: "2026-10-17T01:00:00Z", label: 'Pool, "A"\nmain' },
      ]),
    ).toBe(
      '"recordType","timestamp","closeXlm","label"\r\n' +
        '"gas","2026-10-17T00:00:00Z","0.12",""\r\n' +
        '"yield","2026-10-17T01:00:00Z","","Pool, ""A""\nmain"',
    );
  });

  it("returns an empty string for a series with no records", () => {
    expect(toCsv([])).toBe("");
  });
});

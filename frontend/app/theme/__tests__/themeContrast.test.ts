import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function getThemeTokens(selector: string): Record<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));
  if (!match) {
    throw new Error(`Could not find CSS theme rule "${selector}"`);
  }

  return Object.fromEntries(
    Array.from(match[1].matchAll(/(--[\w-]+)\s*:\s*(#[\da-fA-F]{6})\s*;/g), (token) => [
      token[1],
      token[2],
    ]),
  );
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("theme contrast palette", () => {
  it.each([
    [":root", "--background"],
    ['[data-theme="dark"]', "--background"],
    ['[data-theme="high-contrast"]', "--background"],
  ])("%s text and interactive colors meet WCAG AAA against %s", (selector, backgroundToken) => {
    const tokens = getThemeTokens(selector);
    const background = tokens[backgroundToken];

    for (const token of [
      "--foreground",
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--accent",
      "--accent-hover",
      "--focus-ring-color",
    ]) {
      expect(tokens[token]).toBeDefined();
      expect(contrastRatio(tokens[token], background)).toBeGreaterThanOrEqual(7);
    }
  });
});

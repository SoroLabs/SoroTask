/**
 * Tests for the accessibility harness itself.
 *
 * The contrast maths is worth testing independently: a harness that reports a
 * wrong ratio would make every accessibility assertion in the repo quietly
 * meaningless.
 */

import {
  AA_LARGE_TEXT_CONTRAST,
  AA_TEXT_CONTRAST,
  contrastRatio,
  hasNoViolations,
  meetsAA,
  parseColor,
  relativeLuminance,
} from '../axeHarness';

describe('parseColor', () => {
  it('parses a six-digit hex colour', () => {
    expect(parseColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('parses a three-digit hex colour by doubling each digit', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('is case insensitive', () => {
    expect(parseColor('#FF8800')).toEqual(parseColor('#ff8800'));
  });

  it('parses comma-separated rgb()', () => {
    expect(parseColor('rgb(255, 136, 0)')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('parses space-separated rgb()', () => {
    expect(parseColor('rgb(255 136 0)')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('parses rgba() and ignores alpha', () => {
    expect(parseColor('rgba(255, 136, 0, 0.5)')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('parses percentage channels', () => {
    expect(parseColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('clamps out-of-range channels', () => {
    expect(parseColor('rgb(300, -20, 0)')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('returns null for an unparseable value', () => {
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('#ff88')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('is 1 for white', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('is 0 for black', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it('weights green most heavily', () => {
    // Green carries 0.7152 of the luminance, so pure green must outrank a
    // blue or red of the same channel value.
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    expect(green).toBeGreaterThan(blue);
    expect(green).toBeGreaterThan(red);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const forward = contrastRatio('#ffffff', '#000000');
    const backward = contrastRatio('#000000', '#ffffff');
    expect(forward).not.toBeNull();
    expect(forward as number).toBeCloseTo(backward as number, 10);
  });

  it('matches the published value for #767676 on white', () => {
    // #767676 on white is the canonical 4.5:1 "just passes" grey.
    const ratio = contrastRatio('#767676', '#ffffff');
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeCloseTo(4.54, 1);
  });

  it('returns null when a colour cannot be parsed', () => {
    expect(contrastRatio('not-a-colour', '#ffffff')).toBeNull();
  });
});

describe('meetsAA', () => {
  it('uses 4.5 for normal text', () => {
    expect(AA_TEXT_CONTRAST).toBe(4.5);
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.4)).toBe(false);
  });

  it('uses 3 for large text', () => {
    expect(AA_LARGE_TEXT_CONTRAST).toBe(3);
    expect(meetsAA(3, true)).toBe(true);
    expect(meetsAA(2.9, true)).toBe(false);
  });
});

describe('hasNoViolations', () => {
  it('reports a clean container', async () => {
    const node = document.createElement('div');
    node.innerHTML = '<button type="button">Save</button>';
    document.body.appendChild(node);
    const result = await hasNoViolations(node);
    expect(result.clean).toBe(true);
    expect(result.summary).toBe('no violations');
    node.remove();
  });

  it('summarises a violation with the failing target', async () => {
    const node = document.createElement('div');
    // An unlabelled input is a reliable axe violation in jsdom.
    node.innerHTML = '<input type="text" />';
    document.body.appendChild(node);
    const result = await hasNoViolations(node);
    expect(result.clean).toBe(false);
    expect(result.summary).toMatch(/label/i);
    node.remove();
  });
});

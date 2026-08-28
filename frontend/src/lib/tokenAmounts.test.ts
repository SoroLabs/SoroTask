import { formatUnits, isExactTokenAmount, parseUnits } from './tokenAmounts';

describe('token amount precision', () => {
  it('round-trips values larger than Number.MAX_SAFE_INTEGER exactly', () => {
    const stroops = '9007199254740992';

    expect(formatUnits(stroops, 0)).toBe(stroops);
    expect(parseUnits(stroops, 0)).toBe(9007199254740992n);
  });

  it('formats and parses decimal token values without floating point math', () => {
    expect(parseUnits('1.2345678')).toBe(12345678n);
    expect(formatUnits(12345678n)).toBe('1.2345678');
  });

  it('rejects precision that cannot be represented in base units', () => {
    expect(isExactTokenAmount('1.00000001')).toBe(false);
    expect(() => parseUnits('1.00000001')).toThrow(/decimal places/);
  });
});
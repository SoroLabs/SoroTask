import { formatUnits, fromStroops, isExactTokenAmount, MAX_U128, mulDivCeil, mulDivFloor, parseUnits, toStroops } from './tokenAmounts';

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

  it('round-trips the maximum u128 amount without Number conversion', () => {
    const maximum = formatUnits(MAX_U128, 18);
    expect(parseUnits(maximum, 18)).toBe(MAX_U128);
    expect(() => parseUnits(`${maximum}0`, 18)).toThrow(/maximum u128/);
  });

  it('converts Stellar stroops exactly and exposes explicit division rounding', () => {
    expect(toStroops('123.0000001')).toBe(1230000001n);
    expect(fromStroops(1230000001n)).toBe('123.0000001');
    expect(mulDivFloor(10n, 1n, 3n)).toBe(3n);
    expect(mulDivCeil(10n, 1n, 3n)).toBe(4n);
  });
});

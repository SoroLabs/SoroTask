import {
  assessAllowance,
  createRevokeReviewBundle,
  isAllowanceActive,
  parseAllowanceExport,
  summarizeAllowances,
  type TokenAllowance,
} from './auditLedger';

const owner = `G${'A'.repeat(55)}`;
const tokenAddress = `C${'B'.repeat(55)}`;
const spenderAddress = `G${'C'.repeat(55)}`;

function allowance(overrides: Partial<TokenAllowance> = {}): TokenAllowance {
  return {
    id: 'allowance-1',
    owner,
    network: 'Futurenet',
    tokenAddress,
    tokenSymbol: 'USDC',
    tokenDecimals: 7,
    spenderAddress,
    amount: '10000000',
    expirationLedger: 200,
    observedLedger: 100,
    ...overrides,
  };
}

describe('allowance audit ledger', () => {
  it('validates allowance exports and rejects malformed or duplicate entries', () => {
    expect(parseAllowanceExport(JSON.stringify({ allowances: [allowance()] }))).toHaveLength(1);
    expect(() => parseAllowanceExport('{')).toThrow('not valid JSON');
    expect(() => parseAllowanceExport(JSON.stringify({ allowances: [{ amount: '-1' }] })))
      .toThrow('missing owner');
    expect(() => parseAllowanceExport(JSON.stringify({
      allowances: [allowance(), allowance()],
    }))).toThrow('duplicate allowance ID');
  });

  it('flags maximum Soroban i128 approvals as unlimited and high risk', () => {
    const unlimited = allowance({ amount: ((1n << 127n) - 1n).toString() });
    expect(assessAllowance(unlimited)).toMatchObject({
      isUnlimited: true,
      risk: 'high',
      formattedAmount: 'Unlimited',
    });
  });

  it('formats finite base-unit amounts and labels non-expiring approvals moderate', () => {
    const result = assessAllowance(allowance({
      amount: '12345678',
      expirationLedger: null,
    }));
    expect(result.formattedAmount).toBe('1.2345678');
    expect(result.risk).toBe('moderate');
  });

  it('excludes zeroed and expired approvals from posture scoring', () => {
    const active = allowance();
    const expired = allowance({
      id: 'expired',
      expirationLedger: 99,
      observedLedger: 100,
    });
    const zeroed = allowance({ id: 'zeroed', amount: '0' });

    expect(isAllowanceActive(active)).toBe(true);
    expect(isAllowanceActive(expired)).toBe(false);
    expect(isAllowanceActive(zeroed)).toBe(false);
    expect(summarizeAllowances([active, expired, zeroed])).toMatchObject({
      activeCount: 1,
      highRiskCount: 0,
      moderateRiskCount: 0,
      postureScore: 100,
    });
  });

  it('reduces posture score for unlimited and non-expiring active approvals', () => {
    const summary = summarizeAllowances([
      allowance({ amount: ((1n << 127n) - 1n).toString() }),
      allowance({ id: 'non-expiring', expirationLedger: null }),
    ]);

    expect(summary).toEqual({
      postureScore: 72,
      activeCount: 2,
      highRiskCount: 1,
      moderateRiskCount: 1,
    });
  });

  it('prepares review bundles only for selected active entries on one owner and network', () => {
    const first = allowance();
    const second = allowance({ id: 'allowance-2', spenderAddress: `G${'D'.repeat(55)}` });
    expect(createRevokeReviewBundle([first, second], [first.id, second.id])).toEqual({
      owner,
      network: 'Futurenet',
      allowances: [
        { id: first.id, tokenAddress, spenderAddress },
        { id: second.id, tokenAddress, spenderAddress: second.spenderAddress },
      ],
    });
    expect(() => createRevokeReviewBundle([first], [])).toThrow('Select at least one');
    expect(() => createRevokeReviewBundle([first], ['unknown'])).toThrow('not active');
  });
});

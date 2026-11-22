const { ReserveRebalancer } = require('../reserveRebalancer');

describe('ReserveRebalancer', () => {
  test('tops up only the reserve shortfall through SEP-24', async () => {
    const deposit = jest.fn().mockResolvedValue({ id: 'deposit-1' });
    const rebalancer = new ReserveRebalancer({
      anchor: { deposit }, reserveReader: async () => 250, minReserve: 1000,
      clock: { now: () => 123 },
    });
    await expect(rebalancer.rebalance({ account: 'GABC', amount: 900 })).resolves.toMatchObject({ topUp: 750 });
    expect(deposit).toHaveBeenCalledWith(expect.objectContaining({ amount: 750, idempotencyKey: 'reserve:GABC:XLM:123' }));
  });

  test('supports safe dry runs and does not call the anchor', async () => {
    const deposit = jest.fn();
    const rebalancer = new ReserveRebalancer({ anchor: { deposit }, reserveReader: async () => 0, clock: Date });
    await expect(rebalancer.rebalance({ account: 'GABC', amount: 500, dryRun: true })).resolves.toMatchObject({ dryRun: true, topUp: 500 });
    expect(deposit).not.toHaveBeenCalled();
  });
});

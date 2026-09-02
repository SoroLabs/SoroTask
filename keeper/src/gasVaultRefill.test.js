const { GasVaultRefillMonitor } = require('./gasVaultRefill');

function baseOptions(overrides = {}) {
  return {
    server: {},
    keypair: { publicKey: () => 'GKEEPER' },
    getXlmBalance: async () => 10,
    getSourceAssetBalance: async () => 500,
    routerContractId: 'CROUTER',
    xlmContractId: 'CXLM',
    sourceAssetContractIds: ['CUSDC'],
    triggerThresholdXlm: 30,
    targetBalanceXlm: 100,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('GasVaultRefillMonitor', () => {
  test('does nothing when XLM balance is already above the trigger threshold', async () => {
    const monitor = new GasVaultRefillMonitor(baseOptions({ getXlmBalance: async () => 50 }));
    const result = await monitor.checkAndRefill();
    expect(result).toEqual({ triggered: false, reason: 'above_threshold', xlmBalance: 50 });
  });

  test('reports not_configured when router/xlm/source contract IDs are missing', async () => {
    const monitor = new GasVaultRefillMonitor(baseOptions({ routerContractId: null }));
    const result = await monitor.checkAndRefill();
    expect(result).toEqual({ triggered: false, reason: 'not_configured' });
  });

  test('skips a source asset with zero balance and reports no_usable_source_balance', async () => {
    const monitor = new GasVaultRefillMonitor(baseOptions({ getSourceAssetBalance: async () => 0 }));
    const result = await monitor.checkAndRefill();
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('no_usable_source_balance');
  });

  test('triggers a swap when below threshold and a source asset has balance', async () => {
    const monitor = new GasVaultRefillMonitor(baseOptions());
    monitor._executeSwap = jest.fn().mockResolvedValue({ txHash: 'abc123', amountIn: '500', minOutXlm: '891000000' });

    const result = await monitor.checkAndRefill();

    expect(result.triggered).toBe(true);
    expect(result.swapped.txHash).toBe('abc123');
    expect(monitor._executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAssetContractId: 'CUSDC', sourceBalance: 500 }),
    );
  });

  test('respects the cooldown after a swap', async () => {
    const monitor = new GasVaultRefillMonitor(baseOptions());
    monitor._executeSwap = jest.fn().mockResolvedValue({ txHash: 'abc123' });

    await monitor.checkAndRefill();
    const second = await monitor.checkAndRefill();

    expect(second).toEqual({ triggered: false, reason: 'cooldown' });
    expect(monitor._executeSwap).toHaveBeenCalledTimes(1);
  });

  test('falls through to the next source asset when a swap attempt fails', async () => {
    const monitor = new GasVaultRefillMonitor(
      baseOptions({ sourceAssetContractIds: ['CUSDC', 'CUSDT'] }),
    );
    monitor._executeSwap = jest.fn()
      .mockRejectedValueOnce(new Error('simulation failed'))
      .mockResolvedValueOnce({ txHash: 'fallback-tx' });

    const result = await monitor.checkAndRefill();

    expect(result.triggered).toBe(true);
    expect(result.swapped.txHash).toBe('fallback-tx');
    expect(monitor._executeSwap).toHaveBeenCalledTimes(2);
  });
});

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

describe('TreasuryRefillChannel (issue #1215)', () => {
  const { TreasuryRefillChannel } = require('./gasVaultRefill');

  function channelOptions(overrides = {}) {
    return {
      server: {},
      keeperPublicKey: 'GKEEPER',
      signerSecrets: ['S1', 'S2', 'S3'],
      minSignatures: 2,
      treasuryContractId: 'CTREASURY',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      metrics: { increment: jest.fn() },
      ...overrides,
    };
  }

  test('is a no-op when the treasury contract or signers are not configured', async () => {
    const withoutContract = new TreasuryRefillChannel(
      channelOptions({ treasuryContractId: null }),
    );
    await expect(withoutContract.requestTopUp({ amountXlm: 10 })).resolves.toEqual({
      requested: false,
      reason: 'not_configured',
    });

    const withoutSigners = new TreasuryRefillChannel(
      channelOptions({ signerSecrets: [], minSignatures: 0 }),
    );
    const result = await withoutSigners.requestTopUp({ amountXlm: 10 });
    expect(result).toEqual({ requested: false, reason: 'not_configured' });
  });

  test('rejects when fewer signers than the quorum are configured', async () => {
    const channel = new TreasuryRefillChannel(
      channelOptions({ signerSecrets: ['S1'], minSignatures: 2 }),
    );
    const result = await channel.requestTopUp({ amountXlm: 10 });
    expect(result).toEqual({ requested: false, reason: 'insufficient_signers' });
  });

  test('submits a quorum-signed refill request', async () => {
    const channel = new TreasuryRefillChannel(
      channelOptions({ signerSecrets: ['S1', 'S2', 'S3'], minSignatures: 2 }),
    );
    channel._submit = jest.fn().mockResolvedValue({ requested: true, txHash: 'treasury-tx', signers: 2 });

    const result = await channel.requestTopUp({ amountXlm: 70, reason: 'keeper_gas_low' });

    expect(result).toEqual({ requested: true, txHash: 'treasury-tx', signers: 2 });
    expect(channel._submit).toHaveBeenCalledWith(
      expect.objectContaining({ amountXlm: 70, reason: 'keeper_gas_low' }),
    );
  });

  test('the monitor falls back to the treasury channel when no source asset can be swapped', async () => {
    const treasuryChannel = new TreasuryRefillChannel(channelOptions({}));
    treasuryChannel.requestTopUp = jest.fn().mockResolvedValue({ requested: true, txHash: 'treasury-tx', signers: 2 });

    const monitor = new GasVaultRefillMonitor(
      baseOptions({ treasuryChannel, getSourceAssetBalance: async () => 0 }),
    );

    const result = await monitor.checkAndRefill();

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('treasury_refill_requested');
    expect(result.treasury.txHash).toBe('treasury-tx');
    expect(treasuryChannel.requestTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amountXlm: 70 }), // target 100 - balance 10
    );
  });

  test('the monitor reports no_usable_source_balance when no treasury channel is wired', async () => {
    const monitor = new GasVaultRefillMonitor(
      baseOptions({ getSourceAssetBalance: async () => 0 }),
    );

    const result = await monitor.checkAndRefill();
    expect(result).toEqual({ triggered: false, reason: 'no_usable_source_balance', xlmBalance: 10 });
  });
});

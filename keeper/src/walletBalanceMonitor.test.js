const { WalletBalanceMonitor } = require('./walletBalanceMonitor');

function baseOptions(overrides = {}) {
  return {
    publicKey: 'GKEEPER',
    getBalanceFn: async () => 100,
    sendAlertFn: jest.fn().mockResolvedValue(undefined),
    sweepFn: jest.fn().mockResolvedValue({ txHash: 'sweep-tx' }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    ...overrides,
  };
}

describe('WalletBalanceMonitor burn-rate & liquidity pressure (issue #1215)', () => {
  test('records the startup balance immediately when started', () => {
    jest.useFakeTimers();
    const monitor = new WalletBalanceMonitor(baseOptions());
    const checkSpy = jest.spyOn(monitor, '_checkBalance').mockResolvedValue({
      balance: 100,
      level: 'ok',
      sweepTriggered: false,
    });

    monitor.start();

    expect(checkSpy).toHaveBeenCalledTimes(1); // startup check, not just the interval

    monitor.stop();
    jest.useRealTimers();
  });

  test('logs a warning when balance drops below 20 XLM with a 20 XLM threshold', async () => {
    const sendAlertFn = jest.fn().mockResolvedValue(undefined);
    const monitor = new WalletBalanceMonitor(baseOptions({ getBalanceFn: async () => 19, sendAlertFn }));
    // Issue's Medium layer: warn at < 20 XLM.
    monitor.warningThreshold = 20;
    monitor.criticalThreshold = 10;

    const result = await monitor.checkNow();

    expect(result.level).toBe('warning');
    expect(sendAlertFn).toHaveBeenCalledWith(
      'warning',
      expect.objectContaining({ type: 'WALLET_WARNING', balance: 19 }),
    );
  });

  test('computes a sliding-window burn rate from balance samples', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const monitor = new WalletBalanceMonitor(baseOptions());
    expect(monitor.getBurnRateXlmPerHour()).toBeNull();

    monitor._recordBalanceSample(100);
    jest.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
    monitor._recordBalanceSample(80);
    monitor._recordBalanceSample(70);
    jest.advanceTimersByTime(30 * 60 * 1000); // one hour since the first sample
    monitor._recordBalanceSample(70);

    // 100 -> 70 XLM over one hour = 30 XLM/hour; the mid-sample must not
    // change the oldest-vs-newest slope.
    expect(monitor.getBurnRateXlmPerHour()).toBeCloseTo(30, 6);

    jest.useRealTimers();
  });

  test('drops samples that fall outside the sliding window', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const monitor = new WalletBalanceMonitor(baseOptions());
    monitor._recordBalanceSample(100);
    jest.advanceTimersByTime(2 * monitor.burnRateWindowMs);
    monitor._recordBalanceSample(40);

    // The old sample aged out of the window, so the rate is unknown.
    expect(monitor.getBurnRateXlmPerHour()).toBeNull();

    jest.useRealTimers();
  });

  test('runway projects hours-to-critical from the burn rate', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const monitor = new WalletBalanceMonitor(baseOptions());
    expect(monitor.getRunwayHours()).toBeNull();

    monitor._recordBalanceSample(120);
    jest.advanceTimersByTime(60 * 60 * 1000);
    monitor._recordBalanceSample(70); // 50 XLM/hour burn
    monitor._lastBalance = 70;

    // (70 - 20 critical) / 50 = 1 hour of runway.
    expect(monitor.getRunwayHours()).toBeCloseTo(1, 6);

    jest.useRealTimers();
  });

  test('low-liquidity pause activates inside the runway window', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

    const monitor = new WalletBalanceMonitor(baseOptions());
    monitor.runwayPauseHours = 4;

    // Healthy balance, no burn yet.
    monitor._lastBalance = 100;
    monitor._recordBalanceSample(100);
    expect(monitor.isLowLiquidityPauseActive()).toBe(false);

    // 50 XLM/hour burn at a 70 XLM balance => 1 hour runway < 4 hours.
    jest.advanceTimersByTime(60 * 60 * 1000);
    monitor._recordBalanceSample(70);
    monitor._lastBalance = 70;
    expect(monitor.isLowLiquidityPauseActive()).toBe(true);
    expect(monitor.getLiquidityPressure()).toBe('critical');

    jest.useRealTimers();
  });

  test('critical balance always activates the pause', () => {
    const monitor = new WalletBalanceMonitor(baseOptions());
    monitor._lastBalance = 10;

    expect(monitor.getLiquidityPressure()).toBe('critical');
    expect(monitor.isLowLiquidityPauseActive()).toBe(true);
  });

  test('status exposes burn-rate and pause state', async () => {
    const monitor = new WalletBalanceMonitor(baseOptions({ getBalanceFn: async () => 25 }));
    await monitor.checkNow();

    const status = monitor.getStatus();
    expect(status.lastBalance).toBe(25);
    expect(status.liquidityPressure).toBe('warning');
    expect(status.lowLiquidityPauseActive).toBe(false);
    expect('burnRateXlmPerHour' in status).toBe(true);
    expect('runwayHours' in status).toBe(true);
  });
});

describe('WalletBalanceMonitor multi-sig treasury relaying & reserve alerts (BE-FINAL-21)', () => {
  const { TreasuryRefillChannel } = require('./gasVaultRefill');

  test('requests multi-sig cold-to-hot treasury top-off when below low-water mark', async () => {
    const sendAlertFn = jest.fn().mockResolvedValue(undefined);
    const treasuryChannel = new TreasuryRefillChannel({
      server: {},
      keeperPublicKey: 'GKEEPER',
      signerSecrets: ['S1', 'S2', 'S3'],
      minSignatures: 2,
      treasuryContractId: 'CTREASURY',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    treasuryChannel._submit = jest.fn().mockResolvedValue({ requested: true, txHash: 'msig-tx-1', signers: 2 });

    const monitor = new WalletBalanceMonitor(
      baseOptions({
        getBalanceFn: async () => 12,
        lowWaterMarkXlm: 25,
        sendAlertFn,
        treasuryChannel,
      }),
    );

    const result = await monitor.checkNow();
    expect(result.level).toBe('critical');
    expect(result.treasuryTopUpTriggered).toBe(true);
    expect(treasuryChannel._submit).toHaveBeenCalledWith(
      expect.objectContaining({ amountXlm: 88 }),
    );
    expect(sendAlertFn).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({ type: 'TREASURY_TOPUP_REQUESTED' }),
    );
  });

  test('triggers automated alert when treasury reserves drop below warning threshold', async () => {
    const sendAlertFn = jest.fn().mockResolvedValue(undefined);
    const monitor = new WalletBalanceMonitor(
      baseOptions({
        getBalanceFn: async () => 100,
        getTreasuryBalanceFn: async () => 300,
        treasuryWarningThresholdXlm: 500,
        sendAlertFn,
      }),
    );

    await monitor.checkNow();

    expect(sendAlertFn).toHaveBeenCalledWith(
      'warning',
      expect.objectContaining({
        type: 'TREASURY_RESERVE_LOW',
        reserveBalance: 300,
        threshold: 500,
      }),
    );
    expect(monitor.getStatus().treasuryReserve).toBe(300);
    expect(monitor.getStatus().treasuryReserveWarningActive).toBe(true);
  });

  test('integration/stress: hot wallet never runs out of gas during heavy execution spree', async () => {
    let hotBalance = 80;
    let treasuryReserve = 2000;
    const sendAlertFn = jest.fn().mockResolvedValue(undefined);

    const treasuryChannel = new TreasuryRefillChannel({
      server: {},
      keeperPublicKey: 'GKEEPER',
      signerSecrets: ['S1', 'S2', 'S3'],
      minSignatures: 2,
      treasuryContractId: 'CTREASURY',
      getTreasuryBalance: async () => treasuryReserve,
      treasuryWarningThresholdXlm: 500,
      sendAlertFn,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    treasuryChannel._submit = jest.fn().mockImplementation(async ({ amountXlm }) => {
      treasuryReserve -= amountXlm;
      hotBalance += amountXlm;
      return { requested: true, txHash: `tx-${hotBalance}`, signers: 2 };
    });

    const monitor = new WalletBalanceMonitor(
      baseOptions({
        getBalanceFn: async () => hotBalance,
        lowWaterMarkXlm: 25,
        sendAlertFn,
        treasuryChannel,
      }),
    );

    // Simulate 50 high-frequency execution ticks burning 10 XLM each
    for (let i = 0; i < 50; i += 1) {
      hotBalance -= 10;
      await monitor.checkNow();
      expect(hotBalance).toBeGreaterThan(0);
    }

    expect(treasuryChannel._submit).toHaveBeenCalled();
    expect(treasuryReserve).toBeLessThan(2000);
  });
});

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
    monitor._recordBalanceSample(60);

    // 100 -> 30 XLM over one hour = 70 XLM/hour; the mid-sample must not
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

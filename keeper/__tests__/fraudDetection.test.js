const { FraudDetectionService, IsolationForestDetector } = require('../src/fraudDetection');
const TaskPoller = require('../src/poller');

jest.mock('../src/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

describe('FraudDetectionService', () => {
  let clock;
  let metricsServer;
  let historyManager;
  let currentTime;

  beforeEach(() => {
    currentTime = 0;
    clock = {
      now: jest.fn(() => currentTime),
      set: (value) => {
        currentTime = value;
      },
    };
    metricsServer = {
      increment: jest.fn(),
      updateFraudState: jest.fn(),
      record: jest.fn(),
    };
    historyManager = {
      record: jest.fn(),
      getDriftSnapshot: jest.fn().mockReturnValue([]),
    };
    global.fetch = undefined;
  });

  afterEach(() => {
    delete global.fetch;
  });

  function createService(options = {}) {
    return new FraudDetectionService({
      clock,
      metricsServer,
      historyManager,
      ...options,
    });
  }

  it('records a normal execution without raising an alert', async () => {
    const service = createService();

    const result = service.observeExecution({
      taskId: 1,
      feePaid: 5,
      status: 'SUCCESS',
    });

    await service.flushPendingAlerts();

    expect(result.score).toBe(0);
    expect(result.shouldAlert).toBe(false);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudObservationsTotal', 1);
    expect(historyManager.record).not.toHaveBeenCalled();
  });

  it('detects a rapid fund drain pattern and emits a local alert', async () => {
    const service = createService({
      alertThreshold: 4,
      minDrainFee: 50,
      drainMultiplier: 2,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 10,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
    });

    clock.set(0);
    service.observeExecution({ taskId: 1, feePaid: 10, status: 'SUCCESS' });
    clock.set(1000);
    service.observeExecution({ taskId: 2, feePaid: 10, status: 'SUCCESS' });

    clock.set(360000);
    const result = service.observeExecution({ taskId: 3, feePaid: 90, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(result.shouldAlert).toBe(true);
    expect(result.reasons).toContain('rapid_fund_drain');
    expect(service.getState().stats.alertsSent).toBe(1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsQueuedTotal', 1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSentTotal', 1);
    expect(historyManager.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fraud_alert',
      taskId: '3',
    }));
  });

  it('sends alerts to a configured webhook', async () => {
    const service = createService({
      alertWebhookUrl: 'https://alerts.example.com/fraud',
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      maxAlertAttempts: 1,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    clock.set(0);
    service.observeExecution({ taskId: 10, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://alerts.example.com/fraud');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe('fraud_alert');
    expect(body.taskId).toBe('10');
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSentTotal', 1);
  });

  it('keeps operating when alert delivery fails', async () => {
    const service = createService({
      alertWebhookUrl: 'https://alerts.example.com/fraud',
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      maxAlertAttempts: 1,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    clock.set(0);
    service.observeExecution({ taskId: 99, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(service.getState().stats.alertsFailed).toBe(1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsFailedTotal', 1);
    expect(service.getState().recentErrors.length).toBeGreaterThan(0);
  });

  it('suppresses duplicate alerts inside the debounce window', async () => {
    const service = createService({
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      alertDebounceMs: 600000,
    });

    clock.set(0);
    service.observeExecution({ taskId: 5, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    clock.set(1000);
    service.observeExecution({ taskId: 5, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(service.getState().stats.alertsSuppressed).toBeGreaterThan(0);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSuppressedTotal', 1);
  });

  it('detects repeated failures as a suspicious pattern', async () => {
    const service = createService({
      alertThreshold: 2,
      failureBurstThreshold: 2,
      taskBurstThreshold: 10,
      crossTaskThreshold: 99,
      minDrainFee: 9999,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
    });

    clock.set(0);
    service.observeFailure({ taskId: 44, status: 'FAILED', errorClassification: 'retryable' });
    clock.set(1000);
    const result = service.observeFailure({ taskId: 44, status: 'FAILED', errorClassification: 'retryable' });

    await service.flushPendingAlerts();

    expect(result.reasons).toContain('failure_burst');
    expect(result.shouldAlert).toBe(true);
  });

  describe('Real-Time Flash Loan & Isolation Forest Anomaly Detection (#1464)', () => {
    it('detects flash loan exploits in < 10ms, auto-pauses the task, and generates a detailed exploit report', () => {
      const service = createService();

      // Establish baseline state and gas parameters for task 500
      service.evaluateFlashLoanAnomaly({
        taskId: 500,
        gasUsed: 100,
        callDepth: 1,
        stateVariables: { escrowBalance: 100000, poolReserve: 500000 },
      });
      service.evaluateFlashLoanAnomaly({
        taskId: 500,
        gasUsed: 105,
        callDepth: 1,
        stateVariables: { escrowBalance: 100050, poolReserve: 500100 },
      });

      // Trigger flash loan exploit with state variance spike & escrow drain
      const exploitEval = service.evaluateFlashLoanAnomaly({
        taskId: 500,
        gasUsed: 950,
        callDepth: 9,
        flashLoanBorrowed: 10_000_000,
        escrowDrainRatio: 0.92,
        reentrancyDepth: 3,
        stateVariables: { escrowBalance: 8000, poolReserve: 45000 },
      });

      expect(exploitEval.isAnomalous).toBe(true);
      expect(exploitEval.autoPaused).toBe(true);
      expect(exploitEval.withinLatencySla).toBe(true);
      expect(exploitEval.detectionLatencyMs).toBeLessThan(10);
      expect(exploitEval.reasons).toEqual(
        expect.arrayContaining([
          'flash_loan_exploit_signature',
          'contract_state_variance_spike',
          'abnormal_gas_consumption',
          'suspicious_call_depth',
          'reentrancy_loop_detected',
        ]),
      );
      expect(service.isTaskQuarantined(500)).toBe(true);

      const reports = service.getExploitReports();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        taskId: '500',
        autoPaused: true,
        quarantineStatus: 'QUARANTINED_BEFORE_FINALIZATION',
      });

      expect(service.releaseQuarantine(500)).toBe(true);
      expect(service.isTaskQuarantined(500)).toBe(false);
    });

    it('produces zero false positive interruptions on standard volatile market events', () => {
      const service = createService();

      for (let i = 0; i < 20; i++) {
        const res = service.evaluateFlashLoanAnomaly({
          taskId: 600,
          gasUsed: 120 + (i % 5) * 10,
          callDepth: 2,
          flashLoanBorrowed: 0,
          escrowDrainRatio: 0.05,
          reentrancyDepth: 0,
          stateVariables: {
            escrowBalance: 100000 - i * 100,
            poolReserve: 500000 + (i % 2 === 0 ? 40000 : -35000),
          },
          marketContext: {
            isStandardVolatility: true,
            correlatedAssetMove: true,
          },
        });

        expect(res.isAnomalous).toBe(false);
        expect(res.autoPaused).toBe(false);
        expect(res.withinLatencySla).toBe(true);
      }

      expect(service.isTaskQuarantined(600)).toBe(false);
      expect(service.getExploitReports()).toHaveLength(0);
    });

    it('integrates with TaskPoller to auto-pause anomalous tasks before execution', async () => {
      const service = createService();
      const mockServer = {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 500, closeTime: 1000 }),
      };

      const poller = new TaskPoller(mockServer, 'CCONTRACT', {
        fraudDetection: service,
      });

      poller.getTaskConfig = jest.fn().mockImplementation(async (taskId) => ({
        last_run: 100,
        interval: 60,
        gas_balance: 5000,
        creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        target: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        function: 'execute_strategy',
        args: [],
        executionTelemetry: taskId === 1
          ? {
              gasUsed: 800,
              callDepth: 8,
              flashLoanBorrowed: 5_000_000,
              escrowDrainRatio: 0.85,
              reentrancyDepth: 2,
            }
          : {
              gasUsed: 110,
              callDepth: 1,
              flashLoanBorrowed: 0,
              escrowDrainRatio: 0,
              marketContext: { isStandardVolatility: true },
            },
      }));

      const dueIds = await poller.pollDueTasks([1, 2]);
      expect(dueIds).toEqual([2]);
      expect(service.isTaskQuarantined(1)).toBe(true);

      const forest = new IsolationForestDetector({ numTrees: 10, sampleSize: 16 });
      expect(forest.score([1, 1, 0, 0, 0, 0])).toBeGreaterThan(0);
    });
  });
});

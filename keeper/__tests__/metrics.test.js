// Simple metrics tests
const { Metrics } = require('../src/metrics');

describe('Metrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  it('should create Metrics instance', () => {
    expect(metrics).toBeDefined();
  });

  it('should have counters object', () => {
    expect(metrics.counters).toBeDefined();
    expect(typeof metrics.counters).toBe('object');
  });

  it('should have gauges object', () => {
    expect(metrics.gauges).toBeDefined();
    expect(typeof metrics.gauges).toBe('object');
  });

  it('should increment counter', () => {
    metrics.increment('tasksCheckedTotal');
    expect(metrics.counters.tasksCheckedTotal).toBe(1);
  });

  it('should record gauge value', () => {
    metrics.record('lastCycleDurationMs', 100);
    expect(metrics.gauges.lastCycleDurationMs).toBe(100);
  });

  it('should return snapshot', () => {
    const snapshot = metrics.snapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot).toBe('object');
  });

  it('should include the latest observed ledger sequence in health status', () => {
    metrics.updateHealth({ latestLedgerSequence: 12345 });

    expect(metrics.getHealthStatus(60_000).latestLedgerSequence).toBe(12345);
  });
});

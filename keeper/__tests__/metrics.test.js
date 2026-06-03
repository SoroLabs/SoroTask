// Simple metrics tests
const { Metrics, MetricsHistory } = require('../src/metrics');

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

  it('should record history points on cycle completion', () => {
    metrics.increment('tasksExecutedTotal', 3);
    metrics.increment('tasksFailedTotal', 1);
    metrics.record('lastCycleDurationMs', 250);
    expect(metrics.history.getSamples()).toHaveLength(1);
    expect(metrics.history.getSamples()[0].successRate).toBeCloseTo(0.75);
  });
});

describe('MetricsHistory', () => {
  it('caps samples at maxSamples', () => {
    const history = new MetricsHistory(2);
    history.record({ a: 1 });
    history.record({ a: 2 });
    history.record({ a: 3 });
    expect(history.getSamples()).toHaveLength(2);
    expect(history.getSamples()[0].a).toBe(2);
  });
});

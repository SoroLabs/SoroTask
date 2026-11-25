// Simple metrics tests
const { Metrics, _MetricsHistory } = require('../src/metrics');

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

  it('should store failover state in snapshot', () => {
    metrics.updateFailoverState({
      activeIndex: 1,
      activeRegion: 'us-west',
      healthyEndpoints: 2,
      totalEndpoints: 3,
      endpoints: [{ index: 1, region: 'us-west', unavailable: false }],
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.failover.activeIndex).toBe(1);
    expect(snapshot.failover.activeRegion).toBe('us-west');
    expect(snapshot.failover.totalEndpoints).toBe(3);
  });
});

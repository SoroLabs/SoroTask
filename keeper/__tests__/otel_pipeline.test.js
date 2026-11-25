'use strict';

const { DynamicTraceSampler, IndicatorRegistry } = require('../src/metrics');
const { createLogger } = require('../src/logger');

describe('Issue #1435: Prometheus & OpenTelemetry Distributed Tracing Pipeline', () => {
  describe('DynamicTraceSampler', () => {
    it('initializes with default or custom sampling rate', () => {
      const sampler = new DynamicTraceSampler({ samplingRate: 0.2 });
      expect(sampler.getSamplingRate()).toBe(0.2);
    });

    it('clamps sampling rate to configured min/max boundaries', () => {
      const sampler = new DynamicTraceSampler({ minRate: 0.05, maxRate: 0.8 });
      sampler.setSamplingRate(0.01);
      expect(sampler.getSamplingRate()).toBe(0.05);

      sampler.setSamplingRate(0.99);
      expect(sampler.getSamplingRate()).toBe(0.8);
    });

    it('always samples high-priority, error, or forceSample contexts', () => {
      const sampler = new DynamicTraceSampler({ samplingRate: 0.0 });
      expect(sampler.shouldSample({ error: true })).toBe(true);
      expect(sampler.shouldSample({ forceSample: true })).toBe(true);
      expect(sampler.shouldSample({ priority: 'high' })).toBe(true);
      expect(sampler.shouldSample({ priority: 'normal' })).toBe(false);
    });

    it('guarantees estimated CPU overhead strictly < 1%', () => {
      const sampler = new DynamicTraceSampler();
      const metrics = sampler.getMetrics();
      expect(metrics.estimatedCpuOverheadPercent).toBeLessThan(1.0);
    });
  });

  describe('Latency Percentile Gauges', () => {
    it('computes p50, p95, and p99 execution lateness accurately', () => {
      const registry = new IndicatorRegistry();
      for (let i = 1; i <= 100; i++) {
        registry.recordExecutionLateness(i);
      }
      const lateness = registry.getExecutionLatenessPercentiles();
      expect(lateness.p50).toBeCloseTo(50, 0);
      expect(lateness.p95).toBeCloseTo(95, 0);
      expect(lateness.p99).toBeCloseTo(99, 0);
    });
  });

  describe('W3C TraceContext Propagation in Logger', () => {
    it('correlates W3C traceparent headers across logger child contexts', () => {
      const logger = createLogger('test-otel-pipeline');
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

      const child = logger.childWithTrace(traceparent);
      expect(child.raw.bindings().traceparent).toBe(traceparent);
      expect(child.raw.bindings().trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(child.raw.bindings().span_id).toBe('00f067aa0ba902b7');
    });

    it('correlates rpcCall and txHash when provided in trace context object', () => {
      const logger = createLogger('test-otel-correlator');
      const child = logger.childWithTrace({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        txHash: '0xabc123',
        rpcCall: 'simulateTransaction',
      });

      const bindings = child.raw.bindings();
      expect(bindings.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(bindings.tx_hash).toBe('0xabc123');
      expect(bindings.rpc_call).toBe('simulateTransaction');
    });
  });
});

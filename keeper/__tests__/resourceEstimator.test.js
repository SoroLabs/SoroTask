'use strict';

/**
 * resourceEstimator.test.js - pre-flight resource limits and fee buffering
 * (Issue #1059).
 */

const {
  ResourceEstimator,
  ResourceLimitExceededError,
  extractResources,
  DEFAULT_PROTOCOL_LIMITS,
} = require('../src/resourceEstimator');

const LIMITS = DEFAULT_PROTOCOL_LIMITS;

/** Simulation response in the raw JSON-RPC (snake_case) shape. */
function rawSimulation(resources, minResourceFee = 0) {
  return { sorobanTransactionData: { resources }, minResourceFee };
}

describe('extractResources', () => {
  it('reads the raw JSON-RPC snake_case shape', () => {
    const r = extractResources(
      rawSimulation({ cpu_insns: 1000, mem_bytes: 2000, read_bytes: 300, write_bytes: 400 }, '1000')
    );
    expect(r).toMatchObject({
      cpuInstructions: 1000,
      memoryBytes: 2000,
      readBytes: 300,
      writeBytes: 400,
      resourceFee: 1000,
      extracted: true,
    });
  });

  it('reads the SDK camelCase shape and coerces BigInt', () => {
    const r = extractResources({
      transactionData: {
        resources: {
          instructions: 5000n,
          memBytes: 6000n,
          readBytes: 100,
          writeBytes: 50,
          footprint: { readOnly: [1, 2, 3], readWrite: [1] },
        },
      },
      minResourceFee: 2000n,
    });

    expect(r.cpuInstructions).toBe(5000);
    expect(r.memoryBytes).toBe(6000);
    expect(r.readLedgerEntries).toBe(3);
    expect(r.writeLedgerEntries).toBe(1);
    expect(r.resourceFee).toBe(2000);
  });

  it('flags an unrecognised shape rather than reporting zero usage', () => {
    // Zeros that look like real measurements would read as "uses nothing",
    // which is the most dangerous possible wrong answer here.
    const r = extractResources({ somethingElse: true });
    expect(r.cpuInstructions).toBe(0);
    expect(r.extracted).toBe(false);
  });

  it('survives null and non-object input', () => {
    expect(extractResources(null).extracted).toBe(false);
    expect(extractResources(undefined).extracted).toBe(false);
  });
});

describe('ResourceEstimator - ceilings', () => {
  const estimator = new ResourceEstimator();

  it('accepts a transaction well under the ceiling', () => {
    const result = estimator.evaluate(
      rawSimulation({ cpu_insns: Math.floor(LIMITS.cpuInstructions * 0.5) }, 1000)
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts exactly 85% and rejects just above it', () => {
    expect(
      estimator.evaluate(rawSimulation({ cpu_insns: Math.floor(LIMITS.cpuInstructions * 0.85) })).ok
    ).toBe(true);
    expect(
      estimator.evaluate(rawSimulation({ cpu_insns: Math.floor(LIMITS.cpuInstructions * 0.86) })).ok
    ).toBe(false);
  });

  it('enforces every resource independently', () => {
    const cases = [
      ['memoryBytes', 'mem_bytes'],
      ['readBytes', 'read_bytes'],
      ['writeBytes', 'write_bytes'],
    ];

    for (const [resource, field] of cases) {
      const result = estimator.evaluate(
        rawSimulation({ [field]: Math.floor(LIMITS[resource] * 0.99) })
      );
      expect(result.ok).toBe(false);
      expect(result.violations.map((v) => v.resource)).toContain(resource);
    }
  });

  it('reports what was used, the limit, and the ceiling', () => {
    const result = estimator.evaluate(
      rawSimulation({ cpu_insns: Math.floor(LIMITS.cpuInstructions * 0.9) })
    );
    const violation = result.violations[0];

    // An operator needs the numbers, not just "limit exceeded".
    expect(violation.resource).toBe('cpuInstructions');
    expect(violation.limit).toBe(LIMITS.cpuInstructions);
    expect(violation.allowed).toBe(Math.floor(LIMITS.cpuInstructions * 0.85));
    expect(violation.utilisation).toBeCloseTo(0.9, 5);
  });

  it('honours custom limits and thresholds', () => {
    const custom = new ResourceEstimator({
      limits: { cpuInstructions: 1000 },
      safetyThreshold: 0.5,
    });
    expect(custom.evaluate(rawSimulation({ cpu_insns: 600 })).ok).toBe(false);
    expect(custom.evaluate(rawSimulation({ cpu_insns: 400 })).ok).toBe(true);
  });
});

describe('ResourceEstimator - fee buffering', () => {
  const estimator = new ResourceEstimator();

  it('adds 10% to the simulated resource fee', () => {
    expect(estimator.evaluate(rawSimulation({ cpu_insns: 1 }, 1000)).bufferedFee).toBe(1100);
  });

  it('rounds the buffered fee up', () => {
    // Rounding down would reintroduce the underfunding the buffer exists to
    // prevent, and a fractional stroop is not payable anyway.
    expect(estimator.bufferedFee(999)).toBe(1099);
  });

  it('buffers a zero fee to zero', () => {
    expect(estimator.bufferedFee(0)).toBe(0);
  });
});

describe('ResourceEstimator - assertWithinLimits', () => {
  const estimator = new ResourceEstimator();

  it('returns the evaluation when within limits', () => {
    const result = estimator.assertWithinLimits(rawSimulation({ cpu_insns: 10 }, 100));
    expect(result.ok).toBe(true);
  });

  it('throws a typed error naming the resource and the ceiling', () => {
    expect.assertions(3);
    try {
      estimator.assertWithinLimits(
        rawSimulation({ cpu_insns: Math.floor(LIMITS.cpuInstructions * 0.95) }),
        { taskId: 42 }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceLimitExceededError);
      expect(error.message).toMatch(/cpuInstructions/);
      expect(error.message).toMatch(/85%/);
    }
  });

  it('logs the violation with actionable numbers', () => {
    const logger = { warn: jest.fn() };
    const loud = new ResourceEstimator({ logger });
    loud.evaluate(rawSimulation({ cpu_insns: LIMITS.cpuInstructions }), { taskId: 7 });

    expect(logger.warn).toHaveBeenCalledWith(
      'Task rejected by pre-flight resource check',
      expect.objectContaining({ taskId: 7, reason: 'limit_exceeded' })
    );
  });
});

describe('ResourceEstimator - unparsed simulations', () => {
  it('passes an unparsed simulation by default, so adoption cannot break execution', () => {
    expect(new ResourceEstimator().evaluate({ unknown: true }).ok).toBe(true);
  });

  it('rejects an unparsed simulation in strict mode', () => {
    const strict = new ResourceEstimator({ requireExtraction: true });
    const result = strict.evaluate({ unknown: true });
    expect(result.ok).toBe(false);
    expect(result.unparsed).toBe(true);
  });
});

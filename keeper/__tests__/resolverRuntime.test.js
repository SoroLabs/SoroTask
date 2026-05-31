const { ResolverRuntime, ResolverRuntimeError } = require('../src/resolverRuntime');

function createRuntime(functions, options = {}) {
  return new ResolverRuntime({
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    functions,
    ...options,
  });
}

describe('ResolverRuntime', () => {
  it('evaluates a synchronous JavaScript resolver in a bounded context', async () => {
    const runtime = createRuntime({
      'price-threshold': {
        source: `
          module.exports.resolve = function(input) {
            return {
              isReady: input.taskConfig.price >= input.taskConfig.threshold,
              reason: 'threshold-check',
              metadata: { observed: input.taskConfig.price }
            };
          };
        `,
      },
    });

    const result = await runtime.evaluate('price-threshold', {
      taskId: 10,
      currentTimestamp: 1000,
      taskConfig: { price: 12, threshold: 10 },
    });

    expect(result).toMatchObject({
      resolverId: 'price-threshold',
      runtime: 'javascript',
      isReady: true,
      reason: 'threshold-check',
      metadata: { observed: 12 },
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('normalizes boolean resolver returns', async () => {
    const runtime = createRuntime({
      bool: {
        source: 'module.exports = function() { return false; };',
      },
    });

    await expect(runtime.evaluate('bool', {
      taskId: 1,
      currentTimestamp: 1000,
      taskConfig: {},
    })).resolves.toMatchObject({
      isReady: false,
      resolverId: 'bool',
    });
  });

  it('rejects blocked capabilities during registration', () => {
    expect(() => createRuntime({
      unsafe: {
        source: 'module.exports.resolve = () => process.env;',
      },
    })).toThrow(ResolverRuntimeError);
  });

  it('times out CPU-bound JavaScript resolvers', async () => {
    const runtime = createRuntime({
      slow: {
        timeoutMs: 20,
        source: 'module.exports.resolve = function() { while (true) {} };',
      },
    });

    await expect(runtime.evaluate('slow', {
      taskId: 1,
      currentTimestamp: 1000,
      taskConfig: {},
    })).rejects.toMatchObject({
      code: 'ERR_SCRIPT_EXECUTION_TIMEOUT',
    });
  });

  it('enforces JSON input size limits', async () => {
    const runtime = createRuntime({
      small: {
        maxInputBytes: 20,
        source: 'module.exports.resolve = () => true;',
      },
    });

    await expect(runtime.evaluate('small', {
      taskId: 1,
      currentTimestamp: 1000,
      taskConfig: { large: 'x'.repeat(40) },
    })).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });
});

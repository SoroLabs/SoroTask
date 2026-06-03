const {
  createStructuredError,
  fromError,
  toClientPayload,
  toLogPayload,
  resolveCategory,
  sanitizeMessage,
} = require('../src/structuredErrors');

describe('structuredErrors', () => {
  it('creates errors with stable code and category', () => {
    const err = createStructuredError({
      code: 'simulation_failed',
      message: 'Simulation failed: invalid args',
      correlationId: 'corr-1',
    });

    expect(err.code).toBe('SIMULATION_FAILED');
    expect(err.errorCode).toBe('SIMULATION_FAILED');
    expect(err.category).toBe('contract');
    expect(err.correlationId).toBe('corr-1');
    expect(err.isStructuredError).toBe(true);
  });

  it('normalizes arbitrary errors', () => {
    const raw = new Error('network socket hang up');
    raw.code = 'NETWORK_ERROR';
    const structured = fromError(raw, { correlationId: 'c-2' });

    expect(structured.code).toBe('NETWORK_ERROR');
    expect(structured.category).toBe('network');
    expect(structured.correlationId).toBe('c-2');
  });

  it('strips sensitive content from client payloads', () => {
    const err = createStructuredError({
      code: 'UNKNOWN',
      message: 'Bearer secret-token leaked in KEEPER_SECRET path',
    });
    const payload = toClientPayload(err);

    expect(payload.error.code).toBe('UNKNOWN');
    expect(payload.error.message).toBe('An internal error occurred');
    expect(payload.error).not.toHaveProperty('stack');
  });

  it('includes classification metadata in log payloads', () => {
    const err = createStructuredError({
      code: 'TX_FAILED',
      message: 'Transaction failed',
    });
    const log = toLogPayload(err, { taskId: 42 });

    expect(log.code).toBe('TX_FAILED');
    expect(log.metadata.taskId).toBe(42);
    expect(log.category).toBe('execution');
  });

  it('resolves categories for known codes', () => {
    expect(resolveCategory('RATE_LIMITED')).toBe('network');
    expect(resolveCategory('INVALID_TOKEN')).toBe('auth');
  });

  it('sanitizes long messages', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeMessage(long).length).toBe(500);
  });
});

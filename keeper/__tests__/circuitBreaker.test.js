const { CircuitBreaker, State } = require('../src/circuitBreaker');

describe('CircuitBreaker', () => {
  let breaker;
  let mockFn;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker', {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      halfOpenMaxRequests: 1
    });
    mockFn = jest.fn();
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(State.CLOSED);
  });

  it('should allow requests when CLOSED', async () => {
    mockFn.mockResolvedValue('success');
    const result = await breaker.execute(mockFn);
    expect(result).toBe('success');
    expect(breaker.getState()).toBe(State.CLOSED);
  });

  it('should transition to OPEN after failureThreshold is reached', async () => {
    mockFn.mockRejectedValue(new Error('fail'));

    await expect(breaker.execute(mockFn)).rejects.toThrow('fail');
    expect(breaker.getState()).toBe(State.CLOSED);

    await expect(breaker.execute(mockFn)).rejects.toThrow('fail');
    expect(breaker.getState()).toBe(State.OPEN);
  });

  it('should reject requests when OPEN', async () => {
    breaker.state = State.OPEN;
    breaker.lastFailureTime = Date.now();

    await expect(breaker.execute(mockFn)).rejects.toThrow('Circuit breaker "test-breaker" is OPEN');
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should transition to HALF_OPEN after recoveryTimeoutMs', async () => {
    breaker.state = State.OPEN;
    breaker.lastFailureTime = Date.now() - 200; // Older than 100ms timeout

    mockFn.mockResolvedValue('success');
    const result = await breaker.execute(mockFn);
    
    expect(result).toBe('success');
    expect(breaker.getState()).toBe(State.HALF_OPEN);
  });

  it('should transition back to CLOSED after success in HALF_OPEN', async () => {
    breaker.state = State.HALF_OPEN;
    mockFn.mockResolvedValue('success');

    await breaker.execute(mockFn);
    expect(breaker.getState()).toBe(State.CLOSED);
  });

  it('should transition back to OPEN after failure in HALF_OPEN', async () => {
    breaker.state = State.HALF_OPEN;
    mockFn.mockRejectedValue(new Error('fail'));

    await expect(breaker.execute(mockFn)).rejects.toThrow('fail');
    expect(breaker.getState()).toBe(State.OPEN);
  });
});

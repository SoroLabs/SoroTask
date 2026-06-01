const TracingSystem = require('./tracing');

describe('TracingSystem', () => {
  let tracingSystem;
  
  beforeEach(() => {
    tracingSystem = new TracingSystem('test-service');
  });

  afterEach(async () => {
    if (tracingSystem) {
      await tracingSystem.stop();
    }
  });

  test('should initialize tracing provider with service name', () => {
    expect(tracingSystem.serviceName).toBe('test-service');
    expect(tracingSystem.provider).toBeDefined();
    expect(tracingSystem.exporter).toBeDefined();
  });

  test('should start tracing without throwing an error', () => {
    expect(() => tracingSystem.start()).not.toThrow();
  });

  test('should shutdown gracefully', async () => {
    await expect(tracingSystem.stop()).resolves.not.toThrow();
  });

  test('should fallback to no-op on start failure', () => {
    // Mock failure to test fallback mechanism
    jest.spyOn(tracingSystem.provider, 'register').mockImplementation(() => {
      throw new Error('Registration failed');
    });
    
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    expect(() => tracingSystem.start()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to initialize tracing system, falling back to no-op tracing',
      expect.any(Error)
    );
    
    consoleSpy.mockRestore();
  });
});

const { createRateLimiter } = require('../src/concurrency');

describe('Concurrency Rate Limiter', () => {
  it('should respect concurrency limits', async () => {
    const limiter = createRateLimiter({ concurrency: 2 });
    let activeCount = 0;
    let maxActive = 0;

    const task = async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise(resolve => setTimeout(resolve, 50));
      activeCount--;
      return 'ok';
    };

    await Promise.all([
      limiter(task),
      limiter(task),
      limiter(task),
      limiter(task),
      limiter(task),
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('should respect RPS limits', async () => {
    const rps = 5;
    const limiter = createRateLimiter({ rps });
    const startTime = Date.now();
    const task = async () => 'ok';

    const promises = [];
    // 11 tasks at 5 RPS should take at least 2 seconds
    // Cycle 1 (0ms): 5 tasks
    // Cycle 2 (~1000ms): 5 tasks
    // Cycle 3 (~2000ms): 1 task
    for (let i = 0; i < 11; i++) {
      promises.push(limiter(task));
    }

    await Promise.all(promises);
    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(2000);
  });

  it('should trigger onThrottle callback', async () => {
    const onThrottle = jest.fn();
    const limiter = createRateLimiter({ rps: 2, onThrottle });
    const task = async () => 'ok';

    // Start three tasks. The third one should trigger throttling.
    const promises = [
      limiter(task),
      limiter(task),
      limiter(task)
    ];

    await Promise.all(promises);

    expect(onThrottle).toHaveBeenCalled();
  });

  it('should clear queue', async () => {
    const limiter = createRateLimiter({ concurrency: 1 });
    const slowTask = () => new Promise(resolve => setTimeout(() => resolve('first'), 100));
    const fastTask = () => Promise.resolve('fast');
    
    const p1 = limiter(slowTask);
    const p2 = limiter(fastTask);
    const p3 = limiter(fastTask);

    // Wait a tiny bit to ensure p1 has started
    await new Promise(resolve => setTimeout(resolve, 10));

    limiter.clearQueue();

    const results = await Promise.allSettled([p1, p2, p3]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[0].value).toBe('first');
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason.message).toBe('Queue cleared');
    expect(results[2].status).toBe('rejected');
    expect(results[2].reason.message).toBe('Queue cleared');
  });
});

const { ErrorTracker } = require('../../src/archival-strategy/errorTracker');

describe('ErrorTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new ErrorTracker();
  });

  test('initializes with circuit closed', () => {
    expect(tracker.isCircuitOpen()).toBe(false);
    expect(tracker.errorCount).toBe(0);
  });

  test('tracks errors and opens circuit after threshold', () => {
    const error = new Error('Test error');
    
    for (let i = 0; i < 4; i++) {
      tracker.track(error, 'test-context');
      expect(tracker.isCircuitOpen()).toBe(false);
    }

    tracker.track(error, 'test-context');
    expect(tracker.isCircuitOpen()).toBe(true);
    expect(tracker.errorCount).toBe(5);
    expect(tracker.errors.length).toBe(5);
  });

  test('resets circuit properly', () => {
    const error = new Error('Test error');
    for (let i = 0; i < 5; i++) {
      tracker.track(error, 'test-context');
    }
    
    expect(tracker.isCircuitOpen()).toBe(true);
    tracker.reset();
    expect(tracker.isCircuitOpen()).toBe(false);
    expect(tracker.errorCount).toBe(0);
    expect(tracker.errors.length).toBe(0);
  });
});

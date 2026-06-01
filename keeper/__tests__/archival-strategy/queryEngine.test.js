const { QueryEngine } = require('../../src/archival-strategy/queryEngine');
const { ErrorTracker } = require('../../src/archival-strategy/errorTracker');

describe('QueryEngine', () => {
  let hotDbMock;
  let coldStorageMock;
  let queryEngine;
  let errorTracker;

  beforeEach(() => {
    hotDbMock = {
      query: jest.fn()
    };
    coldStorageMock = {
      query: jest.fn()
    };
    errorTracker = new ErrorTracker();
    queryEngine = new QueryEngine(hotDbMock, coldStorageMock, errorTracker);
  });

  test('queries only hot db for recent logs', async () => {
    const now = Date.now();
    const startTime = now - (10 * 24 * 60 * 60 * 1000); // 10 days ago
    
    hotDbMock.query.mockResolvedValue([{ id: 1, msg: 'hot' }]);

    const results = await queryEngine.fetchLogs(startTime, now);

    expect(results).toEqual([{ id: 1, msg: 'hot' }]);
    expect(hotDbMock.query).toHaveBeenCalled();
    expect(coldStorageMock.query).not.toHaveBeenCalled();
  });

  test('queries only cold storage for very old logs', async () => {
    const now = Date.now();
    const endTime = now - (40 * 24 * 60 * 60 * 1000); // 40 days ago
    const startTime = endTime - (10 * 24 * 60 * 60 * 1000); // 50 days ago
    
    coldStorageMock.query.mockResolvedValue([{ id: 2, msg: 'cold' }]);

    const results = await queryEngine.fetchLogs(startTime, endTime);

    expect(results).toEqual([{ id: 2, msg: 'cold' }]);
    expect(coldStorageMock.query).toHaveBeenCalled();
    expect(hotDbMock.query).not.toHaveBeenCalled();
  });

  test('queries both for overlapping times', async () => {
    const now = Date.now();
    const endTime = now;
    const startTime = now - (40 * 24 * 60 * 60 * 1000); // 40 days ago (crosses the 30-day boundary)

    coldStorageMock.query.mockResolvedValue([{ id: 3, msg: 'cold' }]);
    hotDbMock.query.mockResolvedValue([{ id: 4, msg: 'hot' }]);

    const results = await queryEngine.fetchLogs(startTime, endTime);

    expect(results).toEqual([{ id: 3, msg: 'cold' }, { id: 4, msg: 'hot' }]);
    expect(coldStorageMock.query).toHaveBeenCalled();
    expect(hotDbMock.query).toHaveBeenCalled();
  });

  test('tracks errors on failure', async () => {
    const now = Date.now();
    hotDbMock.query.mockRejectedValue(new Error('Hot DB down'));

    await expect(queryEngine.fetchLogs(now - 1000, now)).rejects.toThrow('Fetch failed: Hot DB down');
    expect(errorTracker.errorCount).toBe(1);
  });

  test('halts if circuit breaker is open', async () => {
    errorTracker.circuitOpen = true;
    await expect(queryEngine.fetchLogs(10, 20)).rejects.toThrow('QueryEngine halted: Circuit breaker is open.');
  });

  test('uses default errorTracker when not provided', async () => {
    const now = Date.now();
    const startTime = now - (10 * 24 * 60 * 60 * 1000);
    hotDbMock.query.mockResolvedValue([]);
    const engineDefault = new QueryEngine(hotDbMock, coldStorageMock);
    const results = await engineDefault.fetchLogs(startTime, now);
    expect(results).toEqual([]);
  });
});

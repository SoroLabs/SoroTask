const { Archiver } = require('../../src/archival-strategy/archiver');
const { ErrorTracker } = require('../../src/archival-strategy/errorTracker');

describe('Archiver', () => {
  let hotDbMock;
  let coldStorageMock;
  let archiver;
  let errorTracker;

  beforeEach(() => {
    hotDbMock = {
      query: jest.fn(),
      run: jest.fn()
    };
    coldStorageMock = {
      write: jest.fn()
    };
    errorTracker = new ErrorTracker();
    archiver = new Archiver(hotDbMock, coldStorageMock, errorTracker);
  });

  test('archives logs successfully', async () => {
    const logs = [{ id: 1, data: 'a' }, { id: 2, data: 'b' }];
    hotDbMock.query.mockResolvedValue(logs);
    coldStorageMock.write.mockResolvedValue();
    hotDbMock.run.mockResolvedValue();

    const count = await archiver.archiveOldLogs(10, 30);
    
    expect(count).toBe(2);
    expect(hotDbMock.query).toHaveBeenCalled();
    expect(coldStorageMock.write).toHaveBeenCalled();
    expect(hotDbMock.run).toHaveBeenCalledWith('DELETE FROM logs WHERE id IN (?)', ['1,2']);
  });

  test('does nothing if no old logs', async () => {
    hotDbMock.query.mockResolvedValue([]);

    const count = await archiver.archiveOldLogs(10, 30);
    
    expect(count).toBe(0);
    expect(coldStorageMock.write).not.toHaveBeenCalled();
    expect(hotDbMock.run).not.toHaveBeenCalled();
  });

  test('tracks errors if pipeline fails', async () => {
    hotDbMock.query.mockRejectedValue(new Error('DB connection lost'));

    await expect(archiver.archiveOldLogs(10, 30)).rejects.toThrow('Archival failed: DB connection lost');
    expect(errorTracker.errorCount).toBe(1);
  });

  test('halts if circuit breaker is open', async () => {
    errorTracker.circuitOpen = true;
    await expect(archiver.archiveOldLogs(10, 30)).rejects.toThrow('Archival halted: Circuit breaker is open.');
  });

  test('uses default errorTracker when not provided', async () => {
    const archiverDefault = new Archiver(hotDbMock, coldStorageMock);
    hotDbMock.query.mockResolvedValue([]);
    const count = await archiverDefault.archiveOldLogs(10, 30);
    expect(count).toBe(0);
  });

  test('uses default batchSize and daysOld when not provided', async () => {
    hotDbMock.query.mockResolvedValue([]);
    const count = await archiver.archiveOldLogs();
    expect(count).toBe(0);
    expect(hotDbMock.query).toHaveBeenCalled();
  });
});

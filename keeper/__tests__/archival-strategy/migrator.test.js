const { Migrator } = require('../../src/archival-strategy/migrator');
const { ErrorTracker } = require('../../src/archival-strategy/errorTracker');

describe('Migrator', () => {
  let dbMock;
  let migrator;
  let errorTracker;

  beforeEach(() => {
    dbMock = {
      run: jest.fn().mockResolvedValue()
    };
    errorTracker = new ErrorTracker();
    migrator = new Migrator(dbMock, errorTracker);
  });

  test('runs migrations successfully in a transaction', async () => {
    const migrations = [
      { id: '1', query: 'CREATE TABLE x;' },
      { id: '2', query: 'CREATE TABLE y;' }
    ];

    await migrator.runMigrations(migrations);

    expect(dbMock.run).toHaveBeenCalledWith('BEGIN TRANSACTION;');
    expect(dbMock.run).toHaveBeenCalledWith('CREATE TABLE x;');
    expect(dbMock.run).toHaveBeenCalledWith('CREATE TABLE y;');
    expect(dbMock.run).toHaveBeenCalledWith('COMMIT;');
    expect(migrator.getAppliedMigrations()).toEqual(['1', '2']);
  });

  test('rolls back transaction on error and tracks it', async () => {
    const migrations = [
      { id: '1', query: 'BAD QUERY;' }
    ];

    dbMock.run
      .mockImplementationOnce(() => Promise.resolve())  // BEGIN TRANSACTION
      .mockImplementationOnce(() => Promise.reject(new Error('Syntax error'))); // migration query

    await expect(migrator.runMigrations(migrations)).rejects.toThrow('Migration failed: Syntax error');

    expect(dbMock.run).toHaveBeenCalledWith('BEGIN TRANSACTION;');
    expect(dbMock.run).toHaveBeenCalledWith('ROLLBACK;');
    expect(errorTracker.errorCount).toBe(1);
  });

  test('halts if circuit breaker is open', async () => {
    errorTracker.circuitOpen = true; // Force open
    await expect(migrator.runMigrations([])).rejects.toThrow('Migration halted: Circuit breaker is open');
  });

  test('uses default errorTracker when not provided', async () => {
    const migratorDefault = new Migrator(dbMock);
    await migratorDefault.runMigrations([]);
    expect(dbMock.run).toHaveBeenCalledWith('BEGIN TRANSACTION;');
    expect(dbMock.run).toHaveBeenCalledWith('COMMIT;');
  });
});

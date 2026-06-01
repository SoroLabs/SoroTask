const { ErrorTracker, Migrator, Archiver, QueryEngine } = require('../../src/archival-strategy/index');

describe('archival-strategy index barrel', () => {
  test('exports ErrorTracker', () => {
    expect(ErrorTracker).toBeDefined();
    expect(typeof ErrorTracker).toBe('function');
  });

  test('exports Migrator', () => {
    expect(Migrator).toBeDefined();
    expect(typeof Migrator).toBe('function');
  });

  test('exports Archiver', () => {
    expect(Archiver).toBeDefined();
    expect(typeof Archiver).toBe('function');
  });

  test('exports QueryEngine', () => {
    expect(QueryEngine).toBeDefined();
    expect(typeof QueryEngine).toBe('function');
  });
});

const { ErrorTracker } = require('./errorTracker');

class Migrator {
  constructor(db, errorTracker = new ErrorTracker()) {
    this.db = db;
    this.errorTracker = errorTracker;
    this.migrationsRun = [];
  }

  async runMigrations(migrations) {
    if (this.errorTracker.isCircuitOpen()) {
      throw new Error('Migration halted: Circuit breaker is open due to previous errors.');
    }

    try {
      // In a robust implementation, use transactions
      await this.db.run('BEGIN TRANSACTION;');

      for (const migration of migrations) {
        await this.db.run(migration.query);
        this.migrationsRun.push(migration.id);
      }

      await this.db.run('COMMIT;');
      return true;
    } catch (error) {
      await this.db.run('ROLLBACK;');
      this.errorTracker.track(error, 'Migration execution');
      throw new Error(`Migration failed: ${error.message}`);
    }
  }

  getAppliedMigrations() {
    return this.migrationsRun;
  }
}

module.exports = { Migrator };

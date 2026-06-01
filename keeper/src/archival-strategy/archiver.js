const { ErrorTracker } = require('./errorTracker');

class Archiver {
  constructor(hotDb, coldStorage, errorTracker = new ErrorTracker()) {
    this.hotDb = hotDb;
    this.coldStorage = coldStorage;
    this.errorTracker = errorTracker;
  }

  async archiveOldLogs(batchSize = 1000, daysOld = 30) {
    if (this.errorTracker.isCircuitOpen()) {
      throw new Error('Archival halted: Circuit breaker is open.');
    }

    try {
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      
      // Step 1: Fetch old logs
      const oldLogs = await this.hotDb.query('SELECT * FROM logs WHERE timestamp < ? LIMIT ?', [cutoffTime, batchSize]);
      
      if (oldLogs.length === 0) {
        return 0; // Nothing to archive
      }

      // Step 2: Write to cold storage (e.g., S3 or local disk mock)
      const archiveId = `archive_${Date.now()}`;
      await this.coldStorage.write(archiveId, oldLogs);

      // Step 3: Delete from hot DB
      const idsToDelete = oldLogs.map(log => log.id);
      await this.hotDb.run('DELETE FROM logs WHERE id IN (?)', [idsToDelete.join(',')]);

      return oldLogs.length;
    } catch (error) {
      this.errorTracker.track(error, 'Archival pipeline');
      throw new Error(`Archival failed: ${error.message}`);
    }
  }
}

module.exports = { Archiver };

const { ErrorTracker } = require('./errorTracker');

class QueryEngine {
  constructor(hotDb, coldStorage, errorTracker = new ErrorTracker()) {
    this.hotDb = hotDb;
    this.coldStorage = coldStorage;
    this.errorTracker = errorTracker;
    this.hotDbRetentionDays = 30; // Matches archival logic
  }

  async fetchLogs(startTime, endTime) {
    if (this.errorTracker.isCircuitOpen()) {
      throw new Error('QueryEngine halted: Circuit breaker is open.');
    }

    try {
      let results = [];
      const hotDbCutoff = Date.now() - (this.hotDbRetentionDays * 24 * 60 * 60 * 1000);

      // Need to query cold storage?
      if (startTime < hotDbCutoff) {
        const coldLogs = await this.coldStorage.query(startTime, Math.min(endTime, hotDbCutoff));
        results = results.concat(coldLogs);
      }

      // Need to query hot db?
      if (endTime >= hotDbCutoff) {
        const hotLogs = await this.hotDb.query('SELECT * FROM logs WHERE timestamp >= ? AND timestamp <= ?', [
          Math.max(startTime, hotDbCutoff),
          endTime
        ]);
        results = results.concat(hotLogs);
      }

      return results;
    } catch (error) {
      this.errorTracker.track(error, 'QueryEngine fetch');
      throw new Error(`Fetch failed: ${error.message}`);
    }
  }
}

module.exports = { QueryEngine };

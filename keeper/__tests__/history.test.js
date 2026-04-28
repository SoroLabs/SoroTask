const fs = require('fs');
const path = require('path');
const HistoryManager = require('../src/history');

describe('HistoryManager', () => {
  const DATA_DIR = path.join(__dirname, '..', 'data');
  const HISTORY_FILE = path.join(DATA_DIR, 'executions.ndjson');

  let history;

  beforeEach(() => {
    // Ensure fresh state
    if (fs.existsSync(HISTORY_FILE)) {
      fs.unlinkSync(HISTORY_FILE);
    }
    history = new HistoryManager();
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(HISTORY_FILE)) {
      fs.unlinkSync(HISTORY_FILE);
    }
  });

  it('should create data directory if it does not exist', () => {
    expect(fs.existsSync(DATA_DIR)).toBe(true);
  });

  it('should append a record to the file', (done) => {
    const record = {
      taskId: 1,
      keeper: 'G123',
      status: 'SUCCESS',
      txHash: 'hash123',
      feePaid: 0.01
    };

    history.record(record);

    // Wait a bit for non-blocking write
    setTimeout(() => {
      expect(fs.existsSync(HISTORY_FILE)).toBe(true);
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.taskId).toBe(1);
      expect(parsed.status).toBe('SUCCESS');
      expect(parsed.timestamp).toBeDefined();
      done();
    }, 100);
  });

  it('should retrieve recent records', async () => {
    const records = [
      { taskId: 1, status: 'SUCCESS' },
      { taskId: 2, status: 'FAILED' },
      { taskId: 3, status: 'ERROR' }
    ];

    records.forEach(r => history.record(r));

    // Wait for writes
    await new Promise(resolve => setTimeout(resolve, 200));

    const recent = await history.getRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0].taskId).toBe(3); // Most recent first
    expect(recent[1].taskId).toBe(2);
  });
});

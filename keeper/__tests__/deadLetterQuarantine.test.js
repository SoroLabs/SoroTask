/**
 * Unit tests for the DeadLetterQueue multi-stage quarantine hardening
 * (issue #1204): failure classification, structured creator alert payload,
 * Telegram dispatch, and the pluggable PostgreSQL persistence store.
 */

const fs = require('fs');
const { DeadLetterQueue, PostgresDeadLetterStore, FailureCategory, classifyTaskFailure } = require('../src/deadLetter');

jest.mock('fs');

jest.mock('../src/ssrfGuard', () => ({
  safeFetch: jest.fn(),
}));

jest.mock('../src/retry', () => ({
  ErrorClassification: {
    RETRYABLE: 'retryable',
    NON_RETRYABLE: 'non_retryable',
    DUPLICATE: 'duplicate',
    UNKNOWN: 'unknown',
  },
  calculateDelay: jest.fn(() => 5000),
}));

const { safeFetch } = require('../src/ssrfGuard');

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createDlq(overrides = {}) {
  return new DeadLetterQueue({
    logger: mockLogger,
    config: {
      maxFailures: 3,
      failureWindowMs: 60000,
      autoQuarantine: true,
      maxRecords: 10,
    },
    ...overrides,
  });
}

describe('classifyTaskFailure', () => {
  it.each([
    ['InsufficientEscrow', new Error('insufficient escrow balance for task')],
    ['InsufficientEscrow', new Error('ESCROW_EMPTY')],
    ['TargetReverted', new Error('call reverted')],
    ['TargetReverted', new Error('target transaction reverted: host error')],
    ['ConditionUnmet', new Error('condition unmet: price below threshold')],
    ['Unknown', new Error('something else entirely')],
  ])('classifies "%s" for %j', (expected, error) => {
    expect(classifyTaskFailure({ error })).toBe(expected);
  });

  it('exports the issue-named categories', () => {
    expect(FailureCategory.INSUFFICIENT_ESCROW).toBe('InsufficientEscrow');
    expect(FailureCategory.TARGET_REVERTED).toBe('TargetReverted');
    expect(FailureCategory.CONDITION_UNMET).toBe('ConditionUnmet');
  });
});

describe('quarantine failure classification and structured creator alerts', () => {
  let dlq;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockReturnValue(undefined);
    safeFetch.mockResolvedValue({ ok: true });
    dlq = createDlq({ config: { webhookUrl: 'https://ops.example.com/dlq' } });
  });

  it('records the failure category on every failure record and the quarantine record', () => {
    dlq.recordFailure(1, {
      error: new Error('insufficient escrow funding'),
      attempt: 1,
    });
    dlq.recordFailure(1, {
      error: new Error('insufficient escrow funding'),
      attempt: 2,
    });
    dlq.recordFailure(1, {
      error: new Error('insufficient escrow funding'),
      attempt: 3,
    });

    expect(dlq.isQuarantined(1)).toBe(true);
    const record = dlq.getRecord(1);
    expect(record.failureCategory).toBe('InsufficientEscrow');
  });

  it('sends a structured creator alert payload with error diagnostics', async () => {
    dlq.recordFailure(42, {
      error: new Error('target transaction reverted'),
      attempt: 3,
      txHash: '0xabc123',
      phase: 'simulation',
      taskConfig: { target: 'CABC', interval: 60 },
    });

    expect(dlq.isQuarantined(42)).toBe(true);
    expect(safeFetch).toHaveBeenCalledTimes(1);

    const [url, options] = safeFetch.mock.calls[0];
    expect(url).toBe('https://ops.example.com/dlq');

    const payload = JSON.parse(options.body);
    expect(payload.type).toBe('task_quarantined');
    expect(payload.taskId).toBe(42);
    expect(payload.failureCategory).toBe('TargetReverted');
    expect(payload.diagnostics).toMatchObject({
      lastErrorMessage: 'target transaction reverted',
      lastTxHash: '0xabc123',
      lastPhase: 'simulation',
    });
    expect(payload.taskConfig).toMatchObject({ target: 'CABC' });
    expect(typeof payload.quarantinedAt).toBe('string');
  });

  it('fans quarantine alerts out through a shared keeper alert manager', () => {
    const alertManager = { notify: jest.fn().mockResolvedValue(undefined) };
    const watched = createDlq({ alertManager });

    watched.recordFailure(7, { error: new Error('condition unmet'), attempt: 3 });

    expect(alertManager.notify).toHaveBeenCalledWith(
      'dlq_quarantine',
      expect.stringContaining('Task 7 quarantined'),
      expect.objectContaining({
        taskId: 7,
        failureCategory: 'ConditionUnmet',
      }),
      'critical'
    );
  });
});

describe('Telegram dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockReturnValue(undefined);
    safeFetch.mockResolvedValue({ ok: true });
  });

  it('posts a Markdown message to the Telegram webhook on quarantine', async () => {
    const watched = createDlq({
      config: {
        webhookUrl: 'https://ops.example.com/dlq',
        telegramWebhookUrl: 'https://telegram.example.com/bot123',
      },
    });
    watched.recordFailure(9, {
      error: new Error('insufficient escrow'),
      attempt: 3,
    });

    expect(safeFetch).toHaveBeenCalledTimes(2);
    const telegramCall = safeFetch.mock.calls.find(
      ([url]) => url === 'https://telegram.example.com/bot123'
    );
    expect(telegramCall).toBeDefined();

    const telegramPayload = JSON.parse(telegramCall[1].body);
    expect(telegramPayload.parse_mode).toBe('Markdown');
    expect(telegramPayload.text).toContain('InsufficientEscrow');
    expect(telegramPayload.text).toContain('Task: 9');
  });

  it('still dispatches when only the Telegram webhook is configured', async () => {
    const watched = createDlq({
      config: { telegramWebhookUrl: 'https://telegram.example.com/bot123' },
    });
    watched.recordFailure(5, { error: new Error('condition unmet'), attempt: 3 });

    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(safeFetch.mock.calls[0][0]).toBe('https://telegram.example.com/bot123');
  });
});

describe('PostgresDeadLetterStore persistence', () => {
  let pg;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockReturnValue(undefined);
    pg = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  });

  it('mirrors quarantine state into Postgres when a pgStore is wired', async () => {
    const store = new PostgresDeadLetterStore(pg);
    const watched = createDlq({ pgStore: store });

    watched.recordFailure(3, { error: new Error('target reverted'), attempt: 3 });
    expect(watched.isQuarantined(3)).toBe(true);

    // The upsert runs asynchronously; flush the microtask queue.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(pg.query).toHaveBeenCalled();
    const upsertCall = pg.query.mock.calls.find(([sql]) => sql.includes('ON CONFLICT (task_id)'));
    expect(upsertCall).toBeDefined();
    expect(upsertCall[1][0]).toBe(3);

    const [savedRecord, savedHistory] = [
      JSON.parse(upsertCall[1][2]),
      JSON.parse(upsertCall[1][3]),
    ];
    expect(savedRecord.failureCategory).toBe('TargetReverted');
    expect(savedHistory).toHaveLength(1);
  });

  it('hydrates state from Postgres after a restart when the file is empty', async () => {
    const store = new PostgresDeadLetterStore(pg);
    pg.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT task_id, quarantined')) {
        return {
          rows: [
            {
              task_id: 11,
              quarantined: true,
              record: JSON.stringify({ taskId: 11, failureCategory: 'ConditionUnmet', status: 'quarantined' }),
              failure_history: '[]',
              backoff: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const watched = createDlq({ pgStore: store });
    await watched._hydrateFromPgStore();

    expect(watched.isQuarantined(11)).toBe(true);
    expect(watched.getRecord(11).failureCategory).toBe('ConditionUnmet');
  });

  it('skips Postgres hydration when a file snapshot already exists', async () => {
    const store = new PostgresDeadLetterStore(pg);
    fs.existsSync.mockReturnValue(true);

    const watched = createDlq({ pgStore: store });
    await watched._hydrateFromPgStore();

    expect(pg.query).not.toHaveBeenCalled();
    expect(watched.getStats().config.autoQuarantine).toBe(true);
  });
});

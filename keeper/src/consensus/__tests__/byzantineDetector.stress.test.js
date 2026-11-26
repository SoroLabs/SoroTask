/**
 * Stress tests for the Byzantine fault detection daemon (issue #1658).
 *
 * Verifies that the daemon keeps up with realistic gossip volume, that every
 * finding stays inside the three-ledger detection window, that memory stays
 * bounded under duplicate floods and that honest traffic is not flagged.
 */

const ByzantineDetector = require('../byzantineDetector');
const { DETECTION_TYPES } = require('../byzantineDetector');
const {
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
} = require('../messages');

jest.setTimeout(60000);

const MESSAGE_SECRET = 'byzantine-stress-secret';

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

const KEEPERS = ['keeper-2', 'keeper-3', 'keeper-4', 'keeper-5', 'keeper-6'];

function createDetector(overrides = {}) {
  return new ByzantineDetector({
    keeperId: 'keeper-1',
    messageSecret: MESSAGE_SECRET,
    hmacSecret: 'byzantine-stress-evidence',
    autoTick: false,
    startTimer: false,
    tipLedger: 1000,
    maxRounds: 5000,
    maxFindings: 500,
    logger: silentLogger,
    ...overrides,
  });
}

function observe(detector, peerId, message, ledger, arrivedAt) {
  return detector.observe(
    {
      type: 'consensus',
      payload: message,
      nodeId: peerId,
      timestamp: arrivedAt,
      nonce: `${peerId}:${message.id}`,
      signature: 'p2p',
    },
    { ledger, arrivedAt, channel: 'consensus' },
  );
}

function heartbeat(detector, peerId, ledger, arrivedAt) {
  detector.observe(
    {
      type: 'heartbeat',
      payload: { url: null },
      nodeId: peerId,
      timestamp: arrivedAt,
      nonce: `heartbeat:${peerId}:${arrivedAt}`,
      signature: 'p2p',
    },
    { ledger, arrivedAt },
  );
}

describe('ByzantineDetector stress', () => {
  let detector;

  afterEach(() => {
    if (detector) {
      detector.shutdown();
      detector = null;
    }
  });

  test('processes 3000 honest rounds without false positives and bounded memory', () => {
    detector = createDetector({ maxRounds: 800, tipLedger: 1000 });
    KEEPERS.forEach((keeperId) => heartbeat(detector, keeperId, 1000, 1000));

    const taskCount = 3000;
    const startedAt = Date.now();

    for (let index = 0; index < taskCount; index++) {
      const taskId = `task-${index}`;
      const ledger = 1000 + Math.floor(index / 4);
      const arrivedAt = 1000 + index * 30;
      const proposer = KEEPERS[index % KEEPERS.length];
      const executor = KEEPERS[(index + 1) % KEEPERS.length];

      observe(
        detector,
        proposer,
        createProposalMessage(taskId, 1, proposer, MESSAGE_SECRET),
        ledger,
        arrivedAt,
      );
      KEEPERS.filter((keeperId) => keeperId !== proposer).forEach((voterId, voteIndex) => {
        observe(
          detector,
          voterId,
          createVoteMessage(taskId, 1, true, voterId, proposer, MESSAGE_SECRET),
          ledger,
          arrivedAt + 50 + voteIndex,
        );
      });
      observe(
        detector,
        proposer,
        createCommitMessage(taskId, 1, executor, proposer, MESSAGE_SECRET),
        ledger,
        arrivedAt + 200,
      );
      observe(
        detector,
        executor,
        createResultMessage(taskId, executor, true, { executedAt: arrivedAt }, MESSAGE_SECRET),
        ledger,
        arrivedAt + 300,
      );

      detector.advanceLedger(ledger + 2, arrivedAt + 300);
    }

    const elapsedMs = Date.now() - startedAt;
    const stats = detector.getStats();

    expect(detector.getFindings()).toHaveLength(0);
    expect(stats.trackedRounds).toBeLessThanOrEqual(800);
    expect(stats.counters.observed).toBeGreaterThanOrEqual(taskCount * 5);
    expect(elapsedMs).toBeLessThan(20000);
  });

  test('detects byzantine behaviour under load within three ledgers', () => {
    detector = createDetector({ tipLedger: 2000 });
    KEEPERS.forEach((keeperId) => heartbeat(detector, keeperId, 2000, 1000));

    const taskCount = 420;
    const startedAt = Date.now();
    let expectedEquivocations = 0;

    for (let index = 0; index < taskCount; index++) {
      const taskId = `task-${index}`;
      const ledger = 2000 + index;
      const arrivedAt = 2000 + index * 100;
      const proposer = 'keeper-2';
      const shouldWithholdVote = index % 7 === 0 && index > 0;
      const shouldEquivocate = index % 10 === 0 && index > 0 && !shouldWithholdVote;
      const shouldWithholdResult = index % 11 === 0 && index > 0;
      const executor = shouldWithholdResult ? 'keeper-5' : 'keeper-3';

      observe(
        detector,
        proposer,
        createProposalMessage(taskId, 1, proposer, MESSAGE_SECRET),
        ledger,
        arrivedAt,
      );

      KEEPERS.filter((keeperId) => keeperId !== proposer).forEach((voterId) => {
        if (shouldWithholdVote && voterId === 'keeper-6') {
          return;
        }
        observe(
          detector,
          voterId,
          createVoteMessage(taskId, 1, true, voterId, proposer, MESSAGE_SECRET),
          ledger,
          arrivedAt + 50,
        );
      });

      if (shouldEquivocate) {
        expectedEquivocations += 1;
        observe(
          detector,
          'keeper-6',
          createVoteMessage(taskId, 1, false, 'keeper-6', proposer, MESSAGE_SECRET),
          ledger,
          arrivedAt + 80,
        );
      }

      observe(
        detector,
        proposer,
        createCommitMessage(taskId, 1, executor, proposer, MESSAGE_SECRET),
        ledger,
        arrivedAt + 200,
      );

      if (!shouldWithholdResult) {
        observe(
          detector,
          executor,
          createResultMessage(taskId, executor, true, {}, MESSAGE_SECRET),
          ledger,
          arrivedAt + 300,
        );
      }

      detector.advanceLedger(ledger + 2, arrivedAt + 300);
    }

    const elapsedMs = Date.now() - startedAt;
    const findings = detector.getFindings();

    const equivocations = detector.getFindings({ type: DETECTION_TYPES.EQUIVOCATION });
    expect(equivocations).toHaveLength(expectedEquivocations);
    equivocations.forEach((finding) => {
      expect(finding.withinDetectionWindow).toBe(true);
      expect(finding.detectionLatencyLedgers).toBeLessThanOrEqual(3);
    });

    const censorship = detector.getFindings({ type: DETECTION_TYPES.CENSORSHIP });
    const withheldVotes = censorship.filter((finding) => finding.pattern === 'vote-withholding');
    const withheldResults = censorship.filter((finding) => finding.pattern === 'result-withholding');
    expect(withheldVotes.length).toBeGreaterThan(0);
    expect(withheldResults.length).toBeGreaterThan(0);
    expect(withheldVotes.some((finding) => finding.subjects.includes('keeper-6'))).toBe(true);
    expect(withheldResults.some((finding) => finding.subjects.includes('keeper-5'))).toBe(true);
    censorship.forEach((finding) => {
      expect(finding.withinDetectionWindow).toBe(true);
    });

    expect(findings.length).toBeLessThanOrEqual(detector.maxFindings);
    expect(elapsedMs).toBeLessThan(25000);
  });

  test('survives a duplicate gossip flood without unbounded growth', () => {
    detector = createDetector({ tipLedger: 3000, maxRounds: 50 });
    KEEPERS.forEach((keeperId) => heartbeat(detector, keeperId, 3000, 1000));

    const proposal = createProposalMessage('task-flood', 1, 'keeper-2', MESSAGE_SECRET);
    observe(detector, 'keeper-2', proposal, 3000, 1000);

    const duplicate = createVoteMessage(
      'task-flood',
      1,
      true,
      'keeper-3',
      'keeper-2',
      MESSAGE_SECRET,
    );
    const startedAt = Date.now();
    for (let index = 0; index < 5000; index++) {
      observe(detector, 'keeper-3', duplicate, 3000, 1000 + index);
    }

    const stats = detector.getStats();
    expect(stats.trackedRounds).toBeLessThanOrEqual(50);
    expect(stats.counters.observed).toBeGreaterThanOrEqual(5000);
    expect(detector.getPeerSuspicion('keeper-3').counters.votes).toBe(1);
    expect(detector.getFindings()).toHaveLength(0);
    expect(Date.now() - startedAt).toBeLessThan(15000);
  });
});

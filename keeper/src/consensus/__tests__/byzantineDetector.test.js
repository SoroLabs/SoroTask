/**
 * Byzantine fault detection daemon tests (issue #1658).
 *
 * Covers the detection rules (censorship, equivocation, front-running,
 * collusion, relay delay, identity spoofing), the three-ledger detection
 * window, cryptographic evidence compilation/verification and bounded state.
 */

const ByzantineDetector = require('../byzantineDetector');
const {
  DETECTION_TYPES,
  verifyEvidence,
  generateSigningKeyPair,
} = require('../byzantineDetector');
const {
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
} = require('../messages');

const MESSAGE_SECRET = 'byzantine-unit-secret';
const EVIDENCE_SECRET = 'byzantine-evidence-secret';

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

function createDetector(overrides = {}) {
  return new ByzantineDetector({
    keeperId: 'keeper-1',
    messageSecret: MESSAGE_SECRET,
    hmacSecret: EVIDENCE_SECRET,
    autoTick: false,
    startTimer: false,
    tipLedger: 100,
    logger: silentLogger,
    ...overrides,
  });
}

function envelopeFor(peerId, message, arrivedAt) {
  return {
    type: 'consensus',
    payload: message,
    nodeId: peerId,
    timestamp: arrivedAt,
    nonce: `${peerId}:${message.id}`,
    signature: 'p2p-signature',
  };
}

function observe(detector, peerId, message, options = {}) {
  const arrivedAt = options.arrivedAt === undefined ? 1000 : options.arrivedAt;
  return detector.observe(envelopeFor(peerId, message, arrivedAt), {
    ledger: options.ledger === undefined ? 100 : options.ledger,
    arrivedAt,
    channel: 'consensus',
  });
}

function heartbeat(detector, peerId, options = {}) {
  const arrivedAt = options.arrivedAt === undefined ? 900 : options.arrivedAt;
  return detector.observe(
    {
      type: 'heartbeat',
      payload: { url: null, load: {} },
      nodeId: peerId,
      timestamp: arrivedAt,
      nonce: `heartbeat:${peerId}:${arrivedAt}`,
      signature: 'p2p-signature',
    },
    {
      ledger: options.ledger === undefined ? 100 : options.ledger,
      arrivedAt,
    },
  );
}

function seedPeers(detector, peerIds, options = {}) {
  peerIds.forEach((peerId) => heartbeat(detector, peerId, options));
}

/**
 * Replay a full consensus round through the detector.
 */
function runRound(detector, options = {}) {
  const {
    taskId = 'task-1',
    epoch = 1,
    proposerId = 'keeper-2',
    voters = [],
    commitExecutor = 'keeper-3',
    resultFrom = 'keeper-3',
    omitResult = false,
    ledger = 100,
    baseAt = 1000,
  } = options;

  const proposal = createProposalMessage(taskId, epoch, proposerId, MESSAGE_SECRET);
  observe(detector, proposerId, proposal, { ledger, arrivedAt: baseAt });

  voters.forEach((voter, index) => {
    const voterId = typeof voter === 'string' ? voter : voter.id;
    const approve = typeof voter === 'string' ? true : voter.approve !== false;
    const vote = createVoteMessage(
      taskId,
      epoch,
      approve,
      voterId,
      proposerId,
      MESSAGE_SECRET,
    );
    observe(detector, voterId, vote, { ledger, arrivedAt: baseAt + 100 + index * 10 });
  });

  if (commitExecutor !== null) {
    const commit = createCommitMessage(
      taskId,
      epoch,
      commitExecutor,
      proposerId,
      MESSAGE_SECRET,
    );
    observe(detector, proposerId, commit, { ledger, arrivedAt: baseAt + 400 });
  }

  if (!omitResult && resultFrom) {
    const result = createResultMessage(
      taskId,
      resultFrom,
      true,
      { executedAt: baseAt },
      MESSAGE_SECRET,
    );
    observe(detector, resultFrom, result, { ledger, arrivedAt: baseAt + 700 });
  }

  return { proposal };
}

describe('ByzantineDetector', () => {
  let detector;

  afterEach(() => {
    if (detector) {
      detector.shutdown();
      detector = null;
    }
  });

  describe('Initialisation and clock', () => {
    test('exposes the three-ledger detection policy', () => {
      detector = createDetector();
      const stats = detector.getStats();

      expect(stats.keeperId).toBe('keeper-1');
      expect(stats.currentLedger).toBe(100);
      expect(stats.policy.detectionWindowLedgers).toBe(3);
      expect(stats.policy.voteGraceLedgers).toBeLessThanOrEqual(3);
      expect(stats.policy.resultGraceLedgers).toBeLessThanOrEqual(3);
      expect(stats.trackedFindings).toBe(0);
    });

    test('tracks ledger time from wall clock when auto-ticking', () => {
      let nowMs = 1000;
      detector = new ByzantineDetector({
        keeperId: 'keeper-1',
        autoTick: true,
        startTimer: false,
        ledgerDurationMs: 1000,
        tipLedger: 50,
        clock: { now: () => nowMs },
        logger: silentLogger,
      });

      expect(detector.getCurrentLedger()).toBe(50);
      nowMs += 2500;
      expect(detector.getCurrentLedger()).toBe(52);
      detector.advanceLedger(60);
      expect(detector.getCurrentLedger()).toBe(60);
    });
  });

  describe('Honest cluster', () => {
    test('does not flag a fully participating round', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3', 'keeper-4'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      detector.advanceLedger(103);

      expect(detector.getFindings()).toHaveLength(0);
      expect(detector.getPeerSuspicion('keeper-3').riskScore).toBe(0);
    });

    test('does not flag withholding without independent corroboration', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: [],
        commitExecutor: 'keeper-3',
        omitResult: true,
      });
      detector.advanceLedger(103);

      // Only the proposer observed the round: (1 < minIndependentSources) so
      // silence is not treated as censorship evidence.
      expect(detector.getFindings()).toHaveLength(0);
    });
  });

  describe('Censorship detection', () => {
    test('flags a live peer that withholds its vote within three ledgers', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      detector.advanceLedger(101);

      const findings = detector.getFindings({
        type: DETECTION_TYPES.CENSORSHIP,
        pattern: 'vote-withholding',
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-4']);
      expect(findings[0].detectionLatencyLedgers).toBe(1);
      expect(findings[0].withinDetectionWindow).toBe(true);
      expect(findings[0].corroboratingSources.length).toBeGreaterThanOrEqual(2);
      expect(findings[0].details.observedVoters).toEqual(['keeper-3']);
    });

    test('flags an assigned executor that withholds its result within three ledgers', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3', 'keeper-4'],
        commitExecutor: 'keeper-4',
        omitResult: true,
      });
      detector.advanceLedger(102);

      const findings = detector.getFindings({
        type: DETECTION_TYPES.CENSORSHIP,
        pattern: 'result-withholding',
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-4']);
      expect(findings[0].detectionLatencyLedgers).toBeLessThanOrEqual(3);
      expect(findings[0].withinDetectionWindow).toBe(true);
    });

    test('flags targeted censorship from repeated contrary voting', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      const voters = [
        { id: 'keeper-3', approve: false },
        { id: 'keeper-4', approve: true },
      ];
      runRound(detector, { taskId: 'task-a', voters, commitExecutor: 'keeper-4', resultFrom: 'keeper-4' });
      runRound(detector, { taskId: 'task-b', voters, commitExecutor: 'keeper-4', resultFrom: 'keeper-4' });
      detector.advanceLedger(103);

      const findings = detector.getFindings({
        type: DETECTION_TYPES.CENSORSHIP,
        pattern: 'contrary-voting',
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-3']);
      expect(findings[0].taskIds).toEqual(expect.arrayContaining(['task-a', 'task-b']));
      expect(findings[0].confidence).toBeGreaterThanOrEqual(0.55);
    });
  });

  describe('Equivocation, spoofing and front-running', () => {
    test('flags contradictory votes as critical equivocation', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3']);
      observe(
        detector,
        'keeper-2',
        createProposalMessage('task-1', 1, 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1000 },
      );

      observe(
        detector,
        'keeper-3',
        createVoteMessage('task-1', 1, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1100 },
      );
      observe(
        detector,
        'keeper-3',
        createVoteMessage('task-1', 1, false, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1150 },
      );

      const findings = detector.getFindings({ type: DETECTION_TYPES.EQUIVOCATION });
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('CRITICAL');
      expect(findings[0].pattern).toBe('conflicting-vote');
      expect(findings[0].subjects).toEqual(['keeper-3']);
      expect(findings[0].details.votes).toEqual([true, false]);
      expect(findings[0].detectionLatencyLedgers).toBe(0);
      expect(detector.getPeerSuspicion('keeper-3').counters.equivocations).toBe(1);
    });

    test('detects gossip senders that impersonate another keeper', () => {
      detector = createDetector();
      const vote = createVoteMessage('task-1', 1, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET);

      detector.observe(envelopeFor('keeper-9', vote, 1000), {
        ledger: 100,
        arrivedAt: 1000,
        channel: 'consensus',
      });

      const findings = detector.getFindings({ type: DETECTION_TYPES.IDENTITY_SPOOFING });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-9']);
      expect(findings[0].details.claimedSourceId).toBe('keeper-3');
      expect(findings[0].severity).toBe('HIGH');
    });

    test('flags executions that consensus did not assign', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3', 'keeper-4'],
        commitExecutor: 'keeper-4',
        resultFrom: 'keeper-3',
      });

      const findings = detector.getFindings({
        type: DETECTION_TYPES.FRONT_RUNNING,
        pattern: 'unauthorized-execution',
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-3']);
      expect(findings[0].details.assignedExecutor).toBe('keeper-4');
      expect(findings[0].details.actualExecutor).toBe('keeper-3');
    });

    test('flags duplicate execution results for one committed task', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3', 'keeper-4'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      observe(
        detector,
        'keeper-4',
        createResultMessage('task-1', 'keeper-4', true, { executedAt: 1400 }, MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1500 },
      );

      const findings = detector.getFindings({
        type: DETECTION_TYPES.FRONT_RUNNING,
        pattern: 'duplicate-execution',
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-3', 'keeper-4']);
    });
  });

  describe('Collusion and relay delay', () => {
    test('flags two keepers whose censorship co-occurs across tasks', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4', 'keeper-5']);

      runRound(detector, {
        taskId: 'task-a',
        voters: ['keeper-3'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      detector.advanceLedger(101);

      runRound(detector, {
        taskId: 'task-b',
        ledger: 101,
        voters: ['keeper-3'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      detector.advanceLedger(102);

      const findings = detector.getFindings({ type: DETECTION_TYPES.COLLUSION });
      expect(findings).toHaveLength(1);
      expect(findings[0].subjects).toEqual(['keeper-4', 'keeper-5']);
      expect(findings[0].details.sharedTasks).toEqual(
        expect.arrayContaining(['task-a', 'task-b']),
      );
      expect(findings[0].confidence).toBeGreaterThanOrEqual(0.6);
    });

    test('accumulates relay delay before flagging a slow replayer', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      for (let round = 0; round < 2; round++) {
        const taskId = `task-delay-${round}`;
        const baseAt = 1000 + round * 10000;
        observe(
          detector,
          'keeper-2',
          createProposalMessage(taskId, 1, 'keeper-2', MESSAGE_SECRET),
          { ledger: 100 + round, arrivedAt: baseAt },
        );
        ['keeper-3', 'keeper-4'].forEach((voterId, index) => {
          observe(
            detector,
            voterId,
            createVoteMessage(taskId, 1, true, voterId, 'keeper-2', MESSAGE_SECRET),
            { ledger: 100 + round, arrivedAt: baseAt + 10000 + index * 10 },
          );
        });
        observe(
          detector,
          'keeper-2',
          createCommitMessage(taskId, 1, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
          { ledger: 100 + round, arrivedAt: baseAt + 10100 },
        );
        observe(
          detector,
          'keeper-3',
          createResultMessage(taskId, 'keeper-3', true, {}, MESSAGE_SECRET),
          { ledger: 100 + round, arrivedAt: baseAt + 10200 },
        );
        detector.advanceLedger(102 + round);
      }

      const findings = detector.getFindings({ type: DETECTION_TYPES.RELAY_DELAY });
      expect(findings).toHaveLength(2);
      expect(findings.map((finding) => finding.subjects[0]).sort()).toEqual([
        'keeper-3',
        'keeper-4',
      ]);
      findings.forEach((finding) => {
        expect(finding.details.lagMs).toBeGreaterThanOrEqual(10000);
        expect(finding.withinDetectionWindow).toBe(true);
      });
    });
  });

  describe('Cryptographic evidence', () => {
    function raiseEquivocation(target) {
      seedPeers(target, ['keeper-2', 'keeper-3']);
      observe(
        target,
        'keeper-2',
        createProposalMessage('task-evidence', 3, 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1000 },
      );
      observe(
        target,
        'keeper-3',
        createVoteMessage('task-evidence', 3, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1050 },
      );
      observe(
        target,
        'keeper-3',
        createVoteMessage('task-evidence', 3, false, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1060 },
      );
      return target.getFindings({ type: DETECTION_TYPES.EQUIVOCATION })[0];
    }

    test('compiles a verifiable HMAC evidence bundle', () => {
      detector = createDetector();
      const finding = raiseEquivocation(detector);

      const bundle = detector.compileEvidence(finding.id);
      expect(bundle.algorithm.signature).toBe('hmac-sha256');
      expect(bundle.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(bundle.observations).toHaveLength(2);
      expect(bundle.observations.every((observation) => observation.signatureVerified)).toBe(true);
      expect(bundle.slashingGrade).toBe(true);
      expect(verifyEvidence(bundle, { hmacSecret: EVIDENCE_SECRET })).toEqual({
        valid: true,
        errors: [],
        algorithm: 'hmac-sha256',
      });

      const tampered = JSON.parse(JSON.stringify(bundle));
      tampered.observations[0].vote = false;
      expect(verifyEvidence(tampered, { hmacSecret: EVIDENCE_SECRET }).valid).toBe(false);
      expect(verifyEvidence(bundle, { hmacSecret: 'wrong-secret' }).valid).toBe(false);
    });

    test('signs evidence with Ed25519 and builds a slashing submission', () => {
      const { privateKey, publicKey } = generateSigningKeyPair();
      detector = createDetector({ hmacSecret: null, signingKey: privateKey });
      const finding = raiseEquivocation(detector);

      const bundle = detector.compileEvidence(finding.id);
      expect(bundle.algorithm.signature).toBe('ed25519');
      expect(bundle.publicKey).toBeTruthy();
      expect(verifyEvidence(bundle, { publicKey })).toEqual({
        valid: true,
        errors: [],
        algorithm: 'ed25519',
      });

      const otherKeys = generateSigningKeyPair();
      expect(verifyEvidence(bundle, { publicKey: otherKeys.publicKey }).valid).toBe(false);

      const submission = detector.buildSlashingSubmission(finding.id);
      expect(submission.requiresGovernanceApproval).toBe(true);
      expect(submission.slashingGrade).toBe(true);
      expect(submission.targets).toEqual([
        expect.objectContaining({
          keeperId: 'keeper-3',
          suggestedPenaltyBps: 5000,
        }),
      ]);
      expect(verifyEvidence(submission.evidence, { publicKey }).valid).toBe(true);
    });

    test('refuses to sign evidence without key material', () => {
      detector = createDetector({ hmacSecret: null, signingKey: null, messageSecret: null });
      const finding = raiseEquivocation(detector);

      expect(() => detector.compileEvidence(finding.id)).toThrow(/signingKey or an hmacSecret/);
    });

    test('marks evidence non-slashing-grade without verified gossip', () => {
      detector = createDetector({ messageSecret: null });
      const finding = raiseEquivocation(detector);

      const bundle = detector.compileEvidence(finding.id);
      expect(bundle.observations.every((observation) => observation.signatureVerified === null)).toBe(true);
      expect(bundle.slashingGrade).toBe(false);
      expect(verifyEvidence(bundle, { hmacSecret: EVIDENCE_SECRET }).valid).toBe(true);
    });
  });

  describe('Safety and bounded state', () => {
    test('ignores own messages and unverifiable gossip', () => {
      detector = createDetector({ messageSecret: 'a-different-secret' });
      const proposal = createProposalMessage('task-1', 1, 'keeper-10', MESSAGE_SECRET);

      const rejected = observe(detector, 'keeper-10', proposal, { ledger: 100, arrivedAt: 1000 });
      expect(rejected.signatureVerified).toBe(false);
      expect(detector.getFindings()).toHaveLength(0);

      detector = createDetector();
      detector.messageSecret = MESSAGE_SECRET;
      const own = observe(
        detector,
        'keeper-1',
        createProposalMessage('task-self', 1, 'keeper-1', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1000 },
      );
      expect(own.self).toBe(true);
      expect(detector.getStats().counters.selfIgnored).toBe(1);
      expect(detector.getFindings()).toHaveLength(0);
    });

    test('emits finding and evidence events', () => {
      detector = createDetector();
      const onFinding = jest.fn();
      const onEvidence = jest.fn();
      detector.on('finding', onFinding);
      detector.on('evidence', onEvidence);

      seedPeers(detector, ['keeper-2', 'keeper-3']);
      observe(
        detector,
        'keeper-2',
        createProposalMessage('task-1', 1, 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1000 },
      );
      observe(
        detector,
        'keeper-3',
        createVoteMessage('task-1', 1, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1050 },
      );
      observe(
        detector,
        'keeper-3',
        createVoteMessage('task-1', 1, false, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
        { ledger: 100, arrivedAt: 1060 },
      );

      expect(onFinding).toHaveBeenCalledTimes(1);
      expect(onFinding.mock.calls[0][0].type).toBe(DETECTION_TYPES.EQUIVOCATION);

      const finding = detector.getFindings()[0];
      detector.compileEvidence(finding.id);
      expect(onEvidence).toHaveBeenCalledTimes(1);
    });

    test('bounds rounds and findings and clears state on shutdown', () => {
      detector = createDetector({ maxRounds: 5, maxFindings: 2 });
      seedPeers(detector, ['keeper-2', 'keeper-3']);

      for (let index = 0; index < 20; index++) {
        runRound(detector, {
          taskId: `task-${index}`,
          voters: ['keeper-3'],
          commitExecutor: 'keeper-3',
          resultFrom: 'keeper-3',
        });
      }
      expect(detector.getStats().trackedRounds).toBeLessThanOrEqual(5);

      // Three independent equivocations, capped to two findings.
      for (let index = 0; index < 3; index++) {
        const taskId = `equivocation-${index}`;
        observe(
          detector,
          'keeper-2',
          createProposalMessage(taskId, 1, 'keeper-2', MESSAGE_SECRET),
          { ledger: 100, arrivedAt: 2000 + index * 1000 },
        );
        observe(
          detector,
          'keeper-3',
          createVoteMessage(taskId, 1, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
          { ledger: 100, arrivedAt: 2100 + index * 1000 },
        );
        observe(
          detector,
          'keeper-3',
          createVoteMessage(taskId, 1, false, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
          { ledger: 100, arrivedAt: 2110 + index * 1000 },
        );
      }
      expect(detector.getFindings().length).toBeLessThanOrEqual(2);

      detector.shutdown();
      expect(detector.getStats().trackedRounds).toBe(0);
      expect(detector.getStats().trackedFindings).toBe(0);
      expect(detector.evaluationTimer).toBeNull();
      detector = null;
    });

    test('filters findings and exposes per-peer suspicion', () => {
      detector = createDetector();
      seedPeers(detector, ['keeper-2', 'keeper-3', 'keeper-4']);

      runRound(detector, {
        voters: ['keeper-3'],
        commitExecutor: 'keeper-3',
        resultFrom: 'keeper-3',
      });
      detector.advanceLedger(101);

      expect(detector.getFindings({ subjectId: 'keeper-4' })).toHaveLength(1);
      expect(detector.getFindings({ subjectId: 'keeper-3' })).toHaveLength(0);
      expect(detector.getFindings({ minConfidence: 0.99 })).toHaveLength(0);

      const suspicion = detector.getPeerSuspicion('keeper-4');
      expect(suspicion.known).toBe(true);
      expect(suspicion.riskScore).toBeGreaterThan(0);
      expect(suspicion.counters.roundsWithheld).toBe(1);
      expect(detector.getPeerSuspicion('unknown-keeper').known).toBe(false);
    });
  });
});

/**
 * Byzantine Fault Detection Daemon (issue #1658)
 *
 * Watches the signed gossip stream that flows between keepers (PROPOSE, VOTE,
 * COMMIT, RESULT plus liveness heartbeats), compares how peers behaved and when
 * their messages arrived, and flags behaviour that a standard "did the task
 * execute?" monitor cannot see:
 *
 *  - EQUIVOCATION      one keeper sends contradictory signed messages for the
 *                      same task/epoch (e.g. votes YES and NO, or commits two
 *                      different executors) - cryptographic proof of byzantine
 *                      behaviour.
 *  - CENSORSHIP        a live keeper withholds its VOTE for a round that other
 *                      peers observed and committed ("vote-withholding"), keeps
 *                      rejecting proposals that reach quorum ("contrary-voting")
 *                      or, as the assigned executor, never publishes a RESULT
 *                      for a committed task ("result-withholding").
 *  - FRONT_RUNNING     a keeper that was not assigned by consensus publishes a
 *                      RESULT for the task, or two keepers claim the same
 *                      execution.
 *  - COLLUSION         a pair of keepers whose censoring behaviour co-occurs on
 *                      the same tasks across rounds.
 *  - RELAY_DELAY       a keeper consistently relays votes/executions far later
 *                      than its peers (selective slow-path / straggler attack).
 *  - IDENTITY_SPOOFING gossip envelope sender does not match the keeper id that
 *                      signed the inner consensus message.
 *
 * Detection happens inside a three-ledger window (the acceptance criterion for
 * issue #1658): the default grace periods are 1 ledger for votes and 2 ledgers
 * for execution results, and every finding reports its
 * `detectionLatencyLedgers`.
 *
 * Evidence is compiled into a deterministic, hash-chained bundle: each observed
 * message is canonicalised, hashed and merkle-rooted, the finding digest is
 * included, and the whole bundle is signed with the detector's Ed25519 key
 * (preferred) or HMAC-SHA256. `buildSlashingSubmission()` wraps a bundle in a
 * slashing recommendation. The daemon never acts on its own: findings are
 * advisory, require independent corroboration for inference-based rules, and
 * always set `requiresExternalArbitration`, so a single keeper cannot censor or
 * slash another (network decentralisation is preserved).
 *
 * Usage:
 *   const detector = new ByzantineDetector({
 *     keeperId: 'keeper-a',
 *     messageSecret: process.env.CONSENSUS_HMAC_SECRET,
 *     signingKey: process.env.BYZANTINE_EVIDENCE_KEY, // Ed25519 private key
 *   });
 *   p2pNetwork.attachByzantineDetector(detector);   // observe gossip
 *   detector.on('finding', (finding) => alert(finding));
 *
 *   const bundle = detector.compileEvidence(finding.id);
 *   const submission = detector.buildSlashingSubmission(finding.id);
 */

'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createLogger } = require('../logger');
const { verifySignature } = require('./messages');

const PROTOCOL_VERSION = '1.0.0';

/** Detection categories emitted by the daemon. */
const DETECTION_TYPES = {
  CENSORSHIP: 'CENSORSHIP',
  EQUIVOCATION: 'EQUIVOCATION',
  FRONT_RUNNING: 'FRONT_RUNNING',
  COLLUSION: 'COLLUSION',
  RELAY_DELAY: 'RELAY_DELAY',
  IDENTITY_SPOOFING: 'IDENTITY_SPOOFING',
};

/** Severity ordering used for aggregation and eviction. */
const DETECTION_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

const SEVERITY_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/**
 * Default policy. `detectionWindowLedgers` is the issue #1658 acceptance
 * criterion: censorship must be detected within three ledgers. The individual
 * grace periods below always stay inside that window.
 */
const DETECTION_POLICY = {
  ledgerDurationMs: 5000, // ~1 Stellar ledger
  detectionWindowLedgers: 3,
  voteGraceLedgers: 1,
  resultGraceLedgers: 2,
  peerLivenessLedgers: 3,
  minConfidence: 0.6,
  minIndependentSources: 2,
  maxVoteLagMs: 7000,
  lateVoteThreshold: 2,
  targetedRejectThreshold: 2,
  targetedRejectRatio: 0.6,
  collusionMinTasks: 2,
  maxRounds: 5000,
  maxFindings: 500,
  maxPeers: 512,
  maxEvidenceObservations: 32,
  maxTasksPerFinding: 25,
};

/** Recommended (never enforced) penalty weights per detection type, in bps. */
const SLASHING_PENALTY_BPS = {
  EQUIVOCATION: 5000,
  FRONT_RUNNING: 4000,
  COLLUSION: 4000,
  IDENTITY_SPOOFING: 5000,
  CENSORSHIP: 2500,
  RELAY_DELAY: 500,
};

const OBSERVATION_KINDS = {
  propose: 'PROPOSE',
  vote: 'VOTE',
  commit: 'COMMIT',
  result: 'RESULT',
  heartbeat: 'LIVENESS',
  peer_discovery: 'LIVENESS',
  hello: 'LIVENESS',
  hello_ack: 'LIVENESS',
  join: 'LIVENESS',
};

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Deterministic JSON canonicalisation (sorted keys, stable formatting) used for
 * every digest and signature in an evidence bundle.
 */
function canonicalize(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }
  if (type === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry === undefined ? null : entry)).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(value) {
  const payload = typeof value === 'string' ? value : canonicalize(value);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Merkle root over hex-encoded sha256 leaves. Odd levels duplicate the last
 * leaf, which keeps the tree shape deterministic for any observation count.
 */
function computeMerkleRoot(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    return sha256Hex('');
  }
  let level = leaves.map((leaf) => Buffer.from(String(leaf), 'hex'));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(crypto.createHash('sha256').update(Buffer.concat([left, right])).digest());
    }
    level = next;
  }
  return level[0].toString('hex');
}

function resolvePublicKey(input) {
  if (input instanceof crypto.KeyObject) {
    return input;
  }
  if (Buffer.isBuffer(input)) {
    const raw = input.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, input]) : input;
    return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
  }
  if (typeof input === 'string') {
    if (input.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey(input);
    }
    const raw = Buffer.from(input, 'base64');
    if (raw.length === 32) {
      return crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
      });
    }
    return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
  }
  throw new Error('Unsupported public key format for evidence verification');
}

function resolvePrivateKey(input) {
  if (input instanceof crypto.KeyObject) {
    return input;
  }
  if (Buffer.isBuffer(input)) {
    const der = input.length === 32 ? Buffer.concat([ED25519_PKCS8_PREFIX, input]) : input;
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  }
  if (typeof input === 'string') {
    if (input.includes('BEGIN PRIVATE KEY')) {
      return crypto.createPrivateKey(input);
    }
    const raw = Buffer.from(input, 'base64');
    if (raw.length === 32) {
      return crypto.createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
        format: 'der',
        type: 'pkcs8',
      });
    }
    return crypto.createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
  }
  throw new Error('Unsupported private key format for evidence signing');
}

/** Ed25519 key pair helper for detectors that sign their own evidence. */
function generateSigningKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

/**
 * Verify an evidence bundle produced by `compileEvidence`.
 *
 * @param {Object} bundle
 * @param {{publicKey?: any, hmacSecret?: string}} [options]
 * @returns {{valid: boolean, errors: string[], algorithm: string|null}}
 */
function verifyEvidence(bundle, options = {}) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: ['bundle is not an object'], algorithm: null };
  }
  const algorithm = bundle.algorithm && bundle.algorithm.signature ? bundle.algorithm.signature : null;
  if (!algorithm) {
    errors.push('missing signature algorithm');
  }
  if (!bundle.signature) {
    errors.push('missing signature');
  }
  if (!Array.isArray(bundle.observations)) {
    errors.push('missing observations');
  }

  if (Array.isArray(bundle.observations)) {
    for (let i = 0; i < bundle.observations.length; i++) {
      const observation = bundle.observations[i];
      if (!observation || typeof observation !== 'object') {
        errors.push(`observation ${i} is invalid`);
        continue;
      }
      const { digest, ...record } = observation;
      if (!digest || sha256Hex(record) !== digest) {
        errors.push(`observation ${i} digest mismatch`);
      }
    }
    const recomputedRoot = computeMerkleRoot(bundle.observations.map((obs) => obs.digest));
    if (recomputedRoot !== bundle.merkleRoot) {
      errors.push('merkle root mismatch');
    }
  }

  if (bundle.finding && sha256Hex(bundle.finding) !== bundle.findingDigest) {
    errors.push('finding digest mismatch');
  }

  const { signature, ...unsigned } = bundle;
  if (signature && algorithm) {
    const payload = Buffer.from(canonicalize(unsigned), 'utf8');
    try {
      if (algorithm === 'ed25519') {
        const publicKey = options.publicKey || bundle.publicKey;
        if (!publicKey) {
          errors.push('missing public key for ed25519 verification');
        } else {
          const ok = crypto.verify(
            null,
            payload,
            resolvePublicKey(publicKey),
            Buffer.from(String(signature), 'base64'),
          );
          if (!ok) {
            errors.push('ed25519 signature mismatch');
          }
        }
      } else if (algorithm === 'hmac-sha256') {
        if (!options.hmacSecret) {
          errors.push('missing hmacSecret for hmac-sha256 verification');
        } else {
          const expected = crypto
            .createHmac('sha256', options.hmacSecret)
            .update(payload)
            .digest('hex');
          const expectedBuf = Buffer.from(expected, 'hex');
          const actualBuf = Buffer.from(String(signature), 'hex');
          if (
            expectedBuf.length !== actualBuf.length
            || !crypto.timingSafeEqual(expectedBuf, actualBuf)
          ) {
            errors.push('hmac signature mismatch');
          }
        }
      } else {
        errors.push(`unsupported signature algorithm: ${algorithm}`);
      }
    } catch (error) {
      errors.push(`signature verification failed: ${error.message}`);
    }
  }

  return { valid: errors.length === 0, errors, algorithm };
}

/**
 * Byzantine fault detection daemon.
 */
class ByzantineDetector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.keeperId = options.keeperId || `keeper-${crypto.randomBytes(4).toString('hex')}`;
    this.logger = options.logger || createLogger('byzantine-detector');
    this.clock = options.clock || { now: () => Date.now() };

    this.ledgerDurationMs = toFiniteNumber(
      options.ledgerDurationMs,
      DETECTION_POLICY.ledgerDurationMs,
    );
    this.detectionWindowLedgers = Math.max(
      1,
      toFiniteNumber(options.detectionWindowLedgers, DETECTION_POLICY.detectionWindowLedgers),
    );
    this.voteGraceLedgers = Math.max(
      0,
      toFiniteNumber(options.voteGraceLedgers, DETECTION_POLICY.voteGraceLedgers),
    );
    this.resultGraceLedgers = Math.max(
      this.voteGraceLedgers,
      toFiniteNumber(options.resultGraceLedgers, DETECTION_POLICY.resultGraceLedgers),
    );
    this.peerLivenessLedgers = Math.max(
      1,
      toFiniteNumber(options.peerLivenessLedgers, DETECTION_POLICY.peerLivenessLedgers),
    );
    this.minConfidence = clamp(
      toFiniteNumber(options.minConfidence, DETECTION_POLICY.minConfidence),
      0,
      1,
    );
    this.minIndependentSources = Math.max(
      1,
      toFiniteNumber(options.minIndependentSources, DETECTION_POLICY.minIndependentSources),
    );
    this.maxVoteLagMs = Math.max(
      1,
      toFiniteNumber(options.maxVoteLagMs, DETECTION_POLICY.maxVoteLagMs),
    );
    this.lateVoteThreshold = Math.max(
      1,
      toFiniteNumber(options.lateVoteThreshold, DETECTION_POLICY.lateVoteThreshold),
    );
    this.targetedRejectThreshold = Math.max(
      1,
      toFiniteNumber(options.targetedRejectThreshold, DETECTION_POLICY.targetedRejectThreshold),
    );
    this.targetedRejectRatio = clamp(
      toFiniteNumber(options.targetedRejectRatio, DETECTION_POLICY.targetedRejectRatio),
      0,
      1,
    );
    this.collusionMinTasks = Math.max(
      1,
      toFiniteNumber(options.collusionMinTasks, DETECTION_POLICY.collusionMinTasks),
    );
    this.maxRounds = Math.max(1, toFiniteNumber(options.maxRounds, DETECTION_POLICY.maxRounds));
    this.maxFindings = Math.max(1, toFiniteNumber(options.maxFindings, DETECTION_POLICY.maxFindings));
    this.maxPeers = Math.max(1, toFiniteNumber(options.maxPeers, DETECTION_POLICY.maxPeers));
    this.maxEvidenceObservations = Math.max(
      1,
      toFiniteNumber(options.maxEvidenceObservations, DETECTION_POLICY.maxEvidenceObservations),
    );
    this.maxTasksPerFinding = Math.max(
      1,
      toFiniteNumber(options.maxTasksPerFinding, DETECTION_POLICY.maxTasksPerFinding),
    );

    // Signature verification: inner consensus messages use the shared HMAC
    // secret, p2p envelopes use the network secret. Both are optional so the
    // daemon can run in observation-only mode, but evidence compiled from
    // unverified observations is never slashing-grade.
    this.messageSecret = options.messageSecret || null;
    this.verifyMessage = typeof options.verifyMessage === 'function' ? options.verifyMessage : null;
    this.verifyEnvelope = typeof options.verifyEnvelope === 'function' ? options.verifyEnvelope : null;

    // Evidence signing.
    this.signingKey = options.signingKey || null;
    this.hmacSecret = options.hmacSecret || null;
    this.autoSubmitEvidence = options.autoSubmitEvidence === true;
    this.evidenceSubmitter = typeof options.evidenceSubmitter === 'function'
      ? options.evidenceSubmitter
      : null;

    // Ledger clock. Tests can pin `tipLedger` and set `autoTick: false`.
    this.autoTick = options.autoTick !== false;
    this.tipLedger = toFiniteNumber(options.tipLedger ?? options.initialLedger, 0);
    this.ledgerAnchorMs = this.clock.now();
    this.evaluationIntervalMs = Math.max(
      50,
      toFiniteNumber(options.evaluationIntervalMs, 1000),
    );
    this.evaluationTimer = null;
    if (this.autoTick && options.startTimer !== false) {
      this.evaluationTimer = setInterval(() => {
        try {
          this._evaluatePendingRounds(this.getCurrentLedger());
        } catch (error) {
          this.logger.warn('Byzantine detector evaluation failed', { error: error.message });
        }
      }, this.evaluationIntervalMs);
      if (typeof this.evaluationTimer.unref === 'function') {
        this.evaluationTimer.unref();
      }
    }

    this.peers = new Map(); // peerId -> peer state
    this.rounds = new Map(); // `${taskId}:${epoch}` -> round state
    this.pendingRounds = new Set();
    this.findings = new Map(); // findingId -> finding
    this.findingsByKey = new Map(); // dedupeKey -> findingId
    this.taskSuspicion = new Map(); // taskId -> Set<peerId>
    this.coOffenses = new Map(); // `peerA|peerB` -> { peers, tasks, lastLedger }
    this.network = null;

    this.stats = {
      observed: 0,
      ignored: 0,
      selfIgnored: 0,
      invalid: 0,
      suppressed: 0,
      findings: 0,
      evidence: 0,
    };

    this.logger.info('Byzantine detector initialized', {
      keeperId: this.keeperId,
      detectionWindowLedgers: this.detectionWindowLedgers,
      minIndependentSources: this.minIndependentSources,
    });
  }

  // -------------------------------------------------------------------------
  // Ledger clock
  // -------------------------------------------------------------------------

  getCurrentLedger(now = this.clock.now()) {
    if (!this.autoTick) {
      return this.tipLedger;
    }
    const elapsed = Math.max(0, now - this.ledgerAnchorMs);
    return this.tipLedger + Math.floor(elapsed / this.ledgerDurationMs);
  }

  /**
   * Advance the observed ledger tip and run time-based detections.
   * @param {number} sequence
   * @param {number} [at]
   * @returns {number} current ledger
   */
  advanceLedger(sequence, at = this.clock.now()) {
    const next = toFiniteNumber(sequence, this.tipLedger);
    if (next > this.tipLedger) {
      this.tipLedger = next;
    }
    this.ledgerAnchorMs = at;
    this._evaluatePendingRounds(this.tipLedger);
    return this.tipLedger;
  }

  // -------------------------------------------------------------------------
  // Observation ingestion
  // -------------------------------------------------------------------------

  /**
   * Ingest a gossip message (p2p envelope or bare consensus message).
   *
   * @param {Object} input - `{type, payload, nodeId, ...}` envelope or consensus message
   * @param {{ledger?: number, arrivedAt?: number, sourceId?: string, channel?: string}} [meta]
   * @returns {Object|null} normalised observation
   */
  observe(input, meta = {}) {
    const observation = this._normalizeObservation(input, meta);
    if (!observation) {
      this.stats.ignored += 1;
      return null;
    }

    this.stats.observed += 1;

    // Ignore our own gossip: a keeper cannot testify against itself, and
    // including self-traffic would double-count rounds.
    if (observation.sourceId === this.keeperId) {
      this.stats.selfIgnored += 1;
      observation.self = true;
      return observation;
    }

    observation.signatureVerified = this._verifyObservation(observation);
    if (observation.signatureVerified === false) {
      this.stats.invalid += 1;
      this.emit('observation:rejected', {
        sourceId: observation.sourceId,
        kind: observation.kind,
        messageId: observation.messageId,
        reason: 'signature_verification_failed',
      });
      return observation;
    }

    try {
      this._applyObservation(observation);
    } catch (error) {
      this.logger.warn('Byzantine observation processing failed', {
        error: error.message,
        kind: observation.kind,
        sourceId: observation.sourceId,
      });
    }
    return observation;
  }

  _normalizeObservation(input, meta) {
    if (!input || typeof input !== 'object') {
      return null;
    }

    let envelope = null;
    let message = null;
    if (input.payload && typeof input.payload === 'object' && (input.nodeId || input.type)) {
      envelope = input;
      message = input.payload;
    } else if (input.type && (input.taskId !== undefined || input.proposerId || input.voterId)) {
      message = input;
    } else {
      return null;
    }

    const rawType = String(message.type || (envelope && envelope.type) || '').toLowerCase();
    const kind = OBSERVATION_KINDS[rawType];
    if (!kind) {
      return null;
    }

    const taskId = message.taskId !== undefined ? message.taskId : null;
    if (kind !== 'LIVENESS' && taskId === null) {
      return null;
    }

    const claimedSourceId = kind === 'VOTE'
      ? message.voterId || null
      : kind === 'RESULT'
        ? message.executorId || message.proposerId || null
        : message.proposerId || message.voterId || null;
    const sourceId = (envelope && envelope.nodeId) || meta.sourceId || claimedSourceId;
    if (!sourceId) {
      return null;
    }

    const arrivedAt = toFiniteNumber(meta.arrivedAt, this.clock.now());
    const ledger = toFiniteNumber(
      meta.ledger,
      toFiniteNumber(
        message.ledgerSequence ?? (message.metadata && message.metadata.ledgerSequence),
        this.getCurrentLedger(arrivedAt),
      ),
    );

    return {
      id: `${message.id || (envelope && envelope.nonce) || crypto.randomUUID()}:${sourceId}`,
      kind,
      channel: meta.channel || (envelope ? 'p2p' : 'direct'),
      taskId: taskId === null ? null : String(taskId),
      epoch: toFiniteNumber(message.epoch, 0),
      sourceId,
      claimedSourceId,
      messageId: message.id || (envelope && envelope.nonce) || null,
      messageType: rawType,
      vote: typeof message.vote === 'boolean' ? message.vote : null,
      executorId: message.executorId || (message.result && message.result.executorId) || null,
      success: message.result && typeof message.result.success === 'boolean'
        ? message.result.success
        : null,
      sentAt: toFiniteNumber(message.timestamp ?? (envelope && envelope.timestamp), arrivedAt),
      arrivedAt,
      ledger,
      signature: message.signature || (envelope && envelope.signature) || null,
      signatureVerified: null,
      identityMismatch: Boolean(
        envelope && claimedSourceId && envelope.nodeId && envelope.nodeId !== claimedSourceId,
      ),
      // Kept only for signature verification; evidence bundles select fields
      // explicitly so raw payloads never leak into a bundle unnoticed.
      rawMessage: message,
      envelope,
      payloadDigest: sha256Hex({
        type: message.type,
        taskId: taskId === null ? null : String(taskId),
        epoch: toFiniteNumber(message.epoch, 0),
        proposerId: message.proposerId || null,
        voterId: message.voterId || null,
        vote: typeof message.vote === 'boolean' ? message.vote : null,
        executorId: message.executorId || null,
        result: message.result || null,
      }),
    };
  }

  _verifyObservation(observation) {
    const results = [];

    if (observation.envelope && typeof this.verifyEnvelope === 'function') {
      try {
        const outcome = this.verifyEnvelope(observation.envelope);
        if (typeof outcome === 'boolean') {
          results.push(outcome);
        } else if (outcome && typeof outcome.ok === 'boolean') {
          results.push(outcome.ok);
        }
      } catch (_error) {
        results.push(false);
      }
    }

    // Consensus messages carry their own HMAC signature in addition to the
    // p2p envelope signature, so a relay cannot forge content for a peer.
    if (this.messageSecret && observation.rawMessage && observation.rawMessage.signature) {
      try {
        results.push(verifySignature(observation.rawMessage, this.messageSecret));
      } catch (_error) {
        results.push(false);
      }
    }

    if (this.verifyMessage && observation.rawMessage) {
      try {
        results.push(this.verifyMessage(observation.rawMessage) === true);
      } catch (_error) {
        results.push(false);
      }
    }

    if (!results.length) {
      return null;
    }
    return results.every(Boolean);
  }

  _applyObservation(observation) {
    const peer = this._touchPeer(observation);
    if (observation.kind === 'LIVENESS') {
      return;
    }

    if (observation.identityMismatch) {
      this._raiseFinding({
        type: DETECTION_TYPES.IDENTITY_SPOOFING,
        pattern: 'sender-mismatch',
        severity: DETECTION_SEVERITY.HIGH,
        subjects: [observation.sourceId],
        taskIds: observation.taskId ? [observation.taskId] : [],
        epoch: observation.epoch,
        ledger: observation.ledger,
        firstLedger: observation.ledger,
        confidence: 0.95,
        observations: [observation],
        corroboratingSources: [observation.sourceId],
        summary: `Gossip sender ${observation.sourceId} claimed to sign for ${observation.claimedSourceId} on task ${observation.taskId}`,
        details: {
          claimedSourceId: observation.claimedSourceId,
          envelopeSenderId: observation.sourceId,
          taskId: observation.taskId,
          epoch: observation.epoch,
        },
      });
    }

    // Consensus RESULT messages do not carry the proposal epoch (they are
    // broadcast as epoch 0 by the engine), so bind them to the latest committed
    // round for the task.
    let epoch = observation.epoch;
    if (observation.kind === 'RESULT' && !epoch) {
      const committed = this._latestCommittedRound(observation.taskId);
      if (committed) {
        epoch = committed.epoch;
        observation.epoch = epoch;
      }
    }

    const round = this._getRound(observation.taskId, epoch, observation);
    switch (observation.kind) {
      case 'PROPOSE':
        this._applyProposal(round, observation);
        break;
      case 'VOTE':
        this._applyVote(round, observation, peer);
        break;
      case 'COMMIT':
        this._applyCommit(round, observation, peer);
        break;
      case 'RESULT':
        this._applyResult(round, observation, peer);
        break;
      default:
        break;
    }
  }

  _touchPeer(observation) {
    if (!observation.sourceId || observation.sourceId === this.keeperId) {
      return null;
    }
    let peer = this.peers.get(observation.sourceId);
    if (!peer) {
      peer = this._createPeer(observation.sourceId, observation.arrivedAt);
      this.peers.set(peer.nodeId, peer);
      this._enforceMapCap(this.peers, this.maxPeers);
    }
    peer.lastSeenAt = Math.max(peer.lastSeenAt, observation.arrivedAt);
    peer.lastSeenLedger = peer.lastSeenLedger === null
      ? observation.ledger
      : Math.max(peer.lastSeenLedger, observation.ledger);
    peer.observations += 1;
    if (observation.kind === 'LIVENESS') {
      peer.heartbeats += 1;
    }
    return peer;
  }

  _createPeer(nodeId, firstSeenAt = this.clock.now()) {
    return {
      nodeId,
      firstSeenAt,
      lastSeenAt: 0,
      lastSeenLedger: null,
      observations: 0,
      heartbeats: 0,
      votes: 0,
      rejections: 0,
      commits: 0,
      results: 0,
      lateVotes: 0,
      equivocations: 0,
      roundsWithheld: 0,
      roundsWithheldResults: 0,
      contraryTasks: new Set(),
    };
  }

  _latestCommittedRound(taskId) {
    let latest = null;
    for (const round of this.rounds.values()) {
      if (round.taskId !== taskId || !round.commit) {
        continue;
      }
      if (!latest || round.epoch > latest.epoch) {
        latest = round;
      }
    }
    return latest;
  }

  _getRound(taskId, epoch, observation) {
    const key = `${taskId}:${epoch}`;
    let round = this.rounds.get(key);
    if (!round) {
      round = {
        key,
        taskId,
        epoch,
        proposal: null,
        votes: new Map(),
        commit: null,
        result: null,
        results: [],
        executorId: null,
        proposalLedger: null,
        commitLedger: null,
        resultLedger: null,
        firstLedger: observation.ledger,
        startedAt: observation.arrivedAt,
        evaluated: new Set(),
      };
      this.rounds.set(key, round);
      this._enforceRoundCap();
    }
    if (!round.proposalLedger || observation.ledger < round.proposalLedger) {
      round.proposalLedger = observation.ledger;
    }
    return round;
  }

  _applyProposal(round, observation) {
    round.proposalLedger = round.proposalLedger === null
      ? observation.ledger
      : Math.min(round.proposalLedger, observation.ledger);

    if (!round.proposal) {
      round.proposal = observation;
      round.startedAt = observation.arrivedAt;
      return;
    }
    if (
      round.proposal.sourceId === observation.sourceId
      && round.proposal.messageId !== observation.messageId
    ) {
      const peer = this.peers.get(observation.sourceId);
      if (peer) {
        peer.equivocations += 1;
      }
      this._raiseFinding({
        type: DETECTION_TYPES.EQUIVOCATION,
        pattern: 'double-proposal',
        severity: DETECTION_SEVERITY.CRITICAL,
        subjects: [observation.sourceId],
        taskIds: [round.taskId],
        epoch: round.epoch,
        ledger: observation.ledger,
        firstLedger: round.proposalLedger,
        confidence: 1,
        observations: [round.proposal, observation],
        corroboratingSources: [observation.sourceId],
        dedupeKey: `EQUIVOCATION:double-proposal:${observation.sourceId}:${round.taskId}:${round.epoch}`,
        summary: `Keeper ${observation.sourceId} broadcast conflicting PROPOSE messages for task ${round.taskId} (epoch ${round.epoch})`,
        details: {
          taskId: round.taskId,
          epoch: round.epoch,
          messageIds: [round.proposal.messageId, observation.messageId],
        },
      });
    }
  }

  _applyVote(round, observation, peer) {
    const existing = round.votes.get(observation.sourceId);
    if (existing) {
      if (
        existing.vote !== null
        && observation.vote !== null
        && existing.vote !== observation.vote
      ) {
        if (peer) {
          peer.equivocations += 1;
        }
        this._raiseFinding({
          type: DETECTION_TYPES.EQUIVOCATION,
          pattern: 'conflicting-vote',
          severity: DETECTION_SEVERITY.CRITICAL,
          subjects: [observation.sourceId],
          taskIds: [round.taskId],
          epoch: round.epoch,
          ledger: observation.ledger,
          firstLedger: round.proposalLedger,
          confidence: 1,
          observations: [existing, observation],
          corroboratingSources: [observation.sourceId],
          dedupeKey: `EQUIVOCATION:conflicting-vote:${observation.sourceId}:${round.taskId}:${round.epoch}`,
          summary: `Keeper ${observation.sourceId} sent contradictory VOTE messages for task ${round.taskId} (epoch ${round.epoch})`,
          details: {
            taskId: round.taskId,
            epoch: round.epoch,
            votes: [existing.vote, observation.vote],
            messageIds: [existing.messageId, observation.messageId],
          },
        });
      }
      return;
    }

    round.votes.set(observation.sourceId, observation);
    if (peer) {
      peer.votes += 1;
      if (observation.vote === false) {
        peer.rejections += 1;
      }
    }

    if (round.proposal && observation.vote !== null) {
      const lag = observation.arrivedAt - round.proposal.arrivedAt;
      const lags = [...round.votes.values()]
        .filter((vote) => vote.arrivedAt >= round.proposal.arrivedAt)
        .map((vote) => vote.arrivedAt - round.proposal.arrivedAt);
      const baseline = median(lags);
      const abnormallyLate = lag > this.maxVoteLagMs
        && (lags.length < 3 || lag > baseline * 3);
      if (peer && abnormallyLate) {
        peer.lateVotes += 1;
        if (peer.lateVotes >= this.lateVoteThreshold) {
          this._raiseFinding({
            type: DETECTION_TYPES.RELAY_DELAY,
            pattern: 'late-vote',
            severity: DETECTION_SEVERITY.LOW,
            subjects: [observation.sourceId],
            taskIds: [round.taskId],
            epoch: round.epoch,
            ledger: observation.ledger,
            firstLedger: round.proposalLedger,
            confidence: clamp(0.5 + 0.1 * (peer.lateVotes - 1), 0.5, 0.8),
            observations: [round.proposal, observation],
            corroboratingSources: [round.proposal.sourceId, observation.sourceId],
            summary: `Keeper ${observation.sourceId} relayed VOTE ${lag}ms after the proposal (median ${Math.round(baseline)}ms) on ${peer.lateVotes} rounds`,
            details: {
              taskId: round.taskId,
              epoch: round.epoch,
              lagMs: lag,
              medianLagMs: Math.round(baseline),
              lateVotes: peer.lateVotes,
            },
          });
        }
      }
    }
  }

  _applyCommit(round, observation, peer) {
    if (!round.commit) {
      round.commit = observation;
      round.commitLedger = observation.ledger;
      round.executorId = observation.executorId;
      round.proposalLedger = round.proposalLedger === null
        ? observation.ledger
        : Math.min(round.proposalLedger, observation.ledger);
      if (peer) {
        peer.commits += 1;
      }
      this.pendingRounds.add(round.key);

      for (const [voterId, voteObservation] of round.votes) {
        if (voteObservation.vote !== false) {
          continue;
        }
        const voter = this.peers.get(voterId);
        if (!voter) {
          continue;
        }
        voter.contraryTasks.add(round.taskId);
        this._recordTaskSuspicion(round.taskId, voterId, observation.ledger);
        const ratio = voter.contraryTasks.size / Math.max(voter.votes, 1);
        if (
          voter.contraryTasks.size >= this.targetedRejectThreshold
          && ratio >= this.targetedRejectRatio
        ) {
          this._raiseFinding({
            type: DETECTION_TYPES.CENSORSHIP,
            pattern: 'contrary-voting',
            severity: ratio >= 0.9 ? DETECTION_SEVERITY.HIGH : DETECTION_SEVERITY.MEDIUM,
            subjects: [voterId],
            taskIds: [...voter.contraryTasks],
            epoch: round.epoch,
            ledger: observation.ledger,
            firstLedger: round.proposalLedger,
            confidence: clamp(
              0.6 + 0.1 * (voter.contraryTasks.size - this.targetedRejectThreshold),
              0.6,
              0.9,
            ),
            observations: [...round.votes.values()].filter((vote) => vote.sourceId === voterId),
            corroboratingSources: [
              round.proposal && round.proposal.sourceId,
              ...round.votes.keys(),
            ].filter(Boolean),
            summary: `Keeper ${voterId} voted NO on ${voter.contraryTasks.size} tasks that reached commit quorum (${Math.round(ratio * 100)}% of its votes)`,
            details: {
              contraryTasks: [...voter.contraryTasks],
              rejectionRatio: Number(ratio.toFixed(4)),
              taskId: round.taskId,
              epoch: round.epoch,
            },
          });
        }
      }

      this._evaluatePendingRounds(observation.ledger);
      return;
    }

    if (round.commit.executorId !== observation.executorId) {
      if (peer) {
        peer.equivocations += 1;
      }
      this._raiseFinding({
        type: DETECTION_TYPES.EQUIVOCATION,
        pattern: 'conflicting-commit',
        severity: DETECTION_SEVERITY.CRITICAL,
        subjects: [observation.sourceId],
        taskIds: [round.taskId],
        epoch: round.epoch,
        ledger: observation.ledger,
        firstLedger: round.proposalLedger,
        confidence: 1,
        observations: [round.commit, observation],
        corroboratingSources: [observation.sourceId],
        dedupeKey: `EQUIVOCATION:conflicting-commit:${observation.sourceId}:${round.taskId}:${round.epoch}`,
        summary: `Keeper ${observation.sourceId} committed two different executors for task ${round.taskId} (epoch ${round.epoch})`,
        details: {
          taskId: round.taskId,
          epoch: round.epoch,
          executors: [round.commit.executorId, observation.executorId],
        },
      });
    }
  }

  _applyResult(round, observation, peer) {
    const assignedExecutor = round.executorId;
    const authorized = !assignedExecutor || observation.sourceId === assignedExecutor;

    if (!authorized) {
      this._raiseFinding({
        type: DETECTION_TYPES.FRONT_RUNNING,
        pattern: 'unauthorized-execution',
        severity: DETECTION_SEVERITY.HIGH,
        subjects: [observation.sourceId],
        taskIds: [round.taskId],
        epoch: round.epoch,
        ledger: observation.ledger,
        firstLedger: round.proposalLedger,
        confidence: 0.9,
        observations: [round.commit, observation].filter(Boolean),
        corroboratingSources: [observation.sourceId],
        dedupeKey: `FRONT_RUNNING:unauthorized-execution:${observation.sourceId}:${round.taskId}:${round.epoch}`,
        summary: `Keeper ${observation.sourceId} published a RESULT for task ${round.taskId}, which consensus assigned to ${assignedExecutor}`,
        details: {
          taskId: round.taskId,
          epoch: round.epoch,
          assignedExecutor,
          actualExecutor: observation.sourceId,
        },
      });
    }

    if (round.result && round.result.sourceId !== observation.sourceId) {
      this._raiseFinding({
        type: DETECTION_TYPES.FRONT_RUNNING,
        pattern: 'duplicate-execution',
        severity: DETECTION_SEVERITY.HIGH,
        subjects: [round.result.sourceId, observation.sourceId],
        taskIds: [round.taskId],
        epoch: round.epoch,
        ledger: observation.ledger,
        firstLedger: round.proposalLedger,
        confidence: 0.9,
        observations: [round.result, observation],
        corroboratingSources: [round.result.sourceId, observation.sourceId],
        summary: `Two keepers (${round.result.sourceId}, ${observation.sourceId}) published RESULT messages for the same task ${round.taskId}`,
        details: {
          taskId: round.taskId,
          epoch: round.epoch,
          executors: [round.result.sourceId, observation.sourceId],
        },
      });
    }

    if (round.result) {
      round.results.push(observation);
      return;
    }

    round.result = observation;
    round.resultLedger = observation.ledger;
    if (peer) {
      peer.results += 1;
    }
    this._evaluatePendingRounds(observation.ledger);
  }

  // -------------------------------------------------------------------------
  // Time-based detections (vote / result withholding)
  // -------------------------------------------------------------------------

  _evaluatePendingRounds(ledger = this.getCurrentLedger()) {
    for (const key of [...this.pendingRounds]) {
      const round = this.rounds.get(key);
      if (!round || !round.commit) {
        this.pendingRounds.delete(key);
        continue;
      }
      const committedAt = round.commitLedger === null ? round.firstLedger : round.commitLedger;
      const voteDeadline = committedAt + this.voteGraceLedgers;
      const resultDeadline = committedAt + this.resultGraceLedgers;

      if (ledger >= voteDeadline && !round.evaluated.has('vote-withholding')) {
        round.evaluated.add('vote-withholding');
        this._detectVoteWithholding(round, Math.max(ledger, voteDeadline));
      }
      if (ledger >= resultDeadline && !round.evaluated.has('result-withholding')) {
        round.evaluated.add('result-withholding');
        this._detectResultWithholding(round, Math.max(ledger, resultDeadline));
      }
      if (
        round.evaluated.has('vote-withholding')
        && round.evaluated.has('result-withholding')
      ) {
        this.pendingRounds.delete(key);
      }
    }
  }

  _isExpectedVoter(peer, round) {
    if (!peer || peer.nodeId === this.keeperId) {
      return false;
    }
    if (round.proposal && peer.nodeId === round.proposal.sourceId) {
      return false; // the proposer is not required to vote on its own proposal
    }
    if (peer.lastSeenLedger === null) {
      return false;
    }
    const referenceLedger = round.proposalLedger === null
      ? round.firstLedger
      : round.proposalLedger;
    if (peer.lastSeenLedger < referenceLedger - this.peerLivenessLedgers) {
      return false;
    }
    // Peers first observed after the proposal cannot be blamed for missing it.
    if (round.proposal && peer.firstSeenAt > round.proposal.arrivedAt) {
      return false;
    }
    return true;
  }

  _detectVoteWithholding(round, detectedAtLedger) {
    const observedSources = new Set();
    if (round.proposal && round.proposal.sourceId) {
      observedSources.add(round.proposal.sourceId);
    }
    for (const vote of round.votes.values()) {
      if (vote.sourceId) {
        observedSources.add(vote.sourceId);
      }
    }

    const silentPeers = [];
    for (const peer of this.peers.values()) {
      if (!this._isExpectedVoter(peer, round)) {
        continue;
      }
      if (round.votes.has(peer.nodeId)) {
        continue;
      }
      silentPeers.push(peer);
    }
    if (!silentPeers.length) {
      return;
    }

    const corroborated = observedSources.size >= this.minIndependentSources;
    for (const peer of silentPeers) {
      peer.roundsWithheld += 1;
      this._recordTaskSuspicion(
        round.taskId,
        peer.nodeId,
        round.commitLedger === null ? round.firstLedger : round.commitLedger,
      );
      if (!corroborated) {
        continue;
      }
      this._raiseFinding({
        type: DETECTION_TYPES.CENSORSHIP,
        pattern: 'vote-withholding',
        severity: peer.roundsWithheld > this.lateVoteThreshold
          ? DETECTION_SEVERITY.HIGH
          : DETECTION_SEVERITY.MEDIUM,
        subjects: [peer.nodeId],
        taskIds: [round.taskId],
        epoch: round.epoch,
        ledger: detectedAtLedger,
        firstLedger: round.proposalLedger === null ? round.firstLedger : round.proposalLedger,
        confidence: clamp(0.6 + 0.1 * (peer.roundsWithheld - 1), 0.6, 0.9),
        observations: [
          round.proposal,
          ...round.votes.values(),
          round.commit,
        ].filter(Boolean),
        corroboratingSources: [...observedSources],
        summary: `Keeper ${peer.nodeId} withheld its signed VOTE for task ${round.taskId} (epoch ${round.epoch}) while ${observedSources.size} peers observed the round`,
        details: {
          taskId: round.taskId,
          epoch: round.epoch,
          pattern: 'vote-withholding',
          observedVoters: [...round.votes.keys()],
          proposalLedger: round.proposalLedger,
          commitLedger: round.commitLedger,
          requiredByLedger: (round.commitLedger === null ? round.firstLedger : round.commitLedger)
            + this.voteGraceLedgers,
        },
      });
    }
  }

  _detectResultWithholding(round, detectedAtLedger) {
    if (round.result || !round.executorId) {
      return;
    }
    // Never accuse ourselves, and require independent peers to have seen the
    // task as due (otherwise absence of a result may simply mean consensus
    // stalled, which is not censorship evidence).
    if (round.executorId === this.keeperId) {
      return;
    }
    if (round.votes.size < this.minIndependentSources) {
      return;
    }

    let peer = this.peers.get(round.executorId);
    if (!peer) {
      peer = this._createPeer(
        round.executorId,
        round.commit ? round.commit.arrivedAt : this.clock.now(),
      );
      this.peers.set(peer.nodeId, peer);
      this._enforceMapCap(this.peers, this.maxPeers);
    }
    peer.roundsWithheldResults += 1;

    const observedSources = new Set();
    if (round.proposal && round.proposal.sourceId) {
      observedSources.add(round.proposal.sourceId);
    }
    for (const vote of round.votes.values()) {
      if (vote.sourceId) {
        observedSources.add(vote.sourceId);
      }
    }

    this._raiseFinding({
      type: DETECTION_TYPES.CENSORSHIP,
      pattern: 'result-withholding',
      severity: DETECTION_SEVERITY.HIGH,
      subjects: [round.executorId],
      taskIds: [round.taskId],
      epoch: round.epoch,
      ledger: detectedAtLedger,
      firstLedger: round.proposalLedger === null ? round.firstLedger : round.proposalLedger,
      confidence: clamp(0.7 + 0.05 * (peer.roundsWithheldResults - 1), 0.7, 0.92),
      observations: [
        round.proposal,
        ...round.votes.values(),
        round.commit,
      ].filter(Boolean),
      corroboratingSources: [...observedSources],
      summary: `Assigned executor ${round.executorId} did not publish a signed RESULT for committed task ${round.taskId} within ${this.resultGraceLedgers} ledger(s)`,
      details: {
        taskId: round.taskId,
        epoch: round.epoch,
        pattern: 'result-withholding',
        executorId: round.executorId,
        commitLedger: round.commitLedger,
        requiredByLedger: (round.commitLedger === null ? round.firstLedger : round.commitLedger)
          + this.resultGraceLedgers,
      },
    });

    this._recordTaskSuspicion(
      round.taskId,
      round.executorId,
      round.commitLedger === null ? round.firstLedger : round.commitLedger,
    );
  }

  // -------------------------------------------------------------------------
  // Collusion graph
  // -------------------------------------------------------------------------

  _recordTaskSuspicion(taskId, peerId, ledger) {
    if (!peerId || peerId === this.keeperId) {
      return;
    }
    let peers = this.taskSuspicion.get(taskId);
    if (!peers) {
      peers = new Set();
      this.taskSuspicion.set(taskId, peers);
      this._enforceMapCap(this.taskSuspicion, this.maxRounds);
    }
    if (peers.has(peerId)) {
      return;
    }
    peers.add(peerId);
    const suspected = [...peers];
    for (let i = 0; i < suspected.length; i++) {
      for (let j = i + 1; j < suspected.length; j++) {
        this._recordCoOffense(suspected[i], suspected[j], taskId, ledger);
      }
    }
  }

  _recordCoOffense(peerA, peerB, taskId, ledger) {
    const pair = [peerA, peerB].sort();
    const key = `${pair[0]}|${pair[1]}`;
    let record = this.coOffenses.get(key);
    if (!record) {
      record = { peers: pair, tasks: new Set(), lastLedger: ledger };
      this.coOffenses.set(key, record);
      this._enforceMapCap(this.coOffenses, this.maxRounds);
    }
    record.tasks.add(taskId);
    record.lastLedger = Math.max(record.lastLedger, ledger);
    if (record.tasks.size < this.collusionMinTasks) {
      return;
    }

    const sharedTasks = [...record.tasks];
    const observations = this._collectObservations(
      sharedTasks.slice(-5),
      record.peers,
    );
    const firstLedger = this._firstLedgerForTasks(sharedTasks);
    this._raiseFinding({
      type: DETECTION_TYPES.COLLUSION,
      pattern: 'correlated-withholding',
      severity: record.tasks.size >= this.collusionMinTasks + 2
        ? DETECTION_SEVERITY.CRITICAL
        : DETECTION_SEVERITY.HIGH,
      subjects: record.peers,
      taskIds: sharedTasks,
      epoch: null,
      ledger: record.lastLedger,
      firstLedger,
      confidence: clamp(
        0.6 + 0.1 * (record.tasks.size - this.collusionMinTasks),
        0.6,
        0.95,
      ),
      observations,
      corroboratingSources: record.peers,
      summary: `Keepers ${record.peers.join(' and ')} censored the same ${record.tasks.size} tasks in a correlated pattern`,
      details: {
        sharedTasks,
        sharedTaskCount: record.tasks.size,
        pair: record.peers,
      },
    });
  }

  _firstLedgerForTasks(taskIds) {
    let first = null;
    const wanted = new Set(taskIds.map(String));
    for (const round of this.rounds.values()) {
      if (!wanted.has(round.taskId) || round.proposalLedger === null) {
        continue;
      }
      first = first === null ? round.proposalLedger : Math.min(first, round.proposalLedger);
    }
    return first === null ? this.getCurrentLedger() : first;
  }

  _collectObservations(taskIds, subjects) {
    const wantedTasks = new Set(taskIds.map(String));
    const wantedSubjects = subjects ? new Set(subjects) : null;
    const observations = [];
    for (const round of this.rounds.values()) {
      if (!wantedTasks.has(round.taskId)) {
        continue;
      }
      if (round.proposal) {
        observations.push(round.proposal);
      }
      for (const vote of round.votes.values()) {
        if (!wantedSubjects || wantedSubjects.has(vote.sourceId)) {
          observations.push(vote);
        }
      }
      if (round.commit) {
        observations.push(round.commit);
      }
      if (round.result) {
        observations.push(round.result);
      }
    }
    return observations.slice(-this.maxEvidenceObservations);
  }

  // -------------------------------------------------------------------------
  // Findings
  // -------------------------------------------------------------------------

  _raiseFinding(params) {
    const {
      type,
      pattern = 'default',
      severity = DETECTION_SEVERITY.MEDIUM,
      subjects = [],
      taskIds = [],
      epoch = null,
      ledger = this.getCurrentLedger(),
      firstLedger,
      confidence = 0.6,
      observations = [],
      corroboratingSources = [],
      summary,
      details = {},
      dedupeKey,
    } = params;

    const uniqueSubjects = [...new Set(subjects.filter((id) => id && id !== this.keeperId))].sort();
    if (!uniqueSubjects.length) {
      return null;
    }
    if (confidence < this.minConfidence) {
      this.stats.suppressed += 1;
      return null;
    }

    const uniqueTasks = [...new Set(taskIds.filter((id) => id !== null && id !== undefined)
      .map(String))].slice(0, this.maxTasksPerFinding);
    const first = firstLedger === null || firstLedger === undefined
      ? ledger
      : Math.min(firstLedger, ledger);
    const key = dedupeKey || `${type}:${pattern}:${uniqueSubjects.join('|')}`;
    const existingId = this.findingsByKey.get(key);
    const sanitizedObservations = observations
      .filter(Boolean)
      .slice(-this.maxEvidenceObservations);
    const arrivedAt = sanitizedObservations.length
      ? sanitizedObservations[sanitizedObservations.length - 1].arrivedAt
      : this.clock.now();

    const existing = existingId ? this.findings.get(existingId) : null;
    if (existing) {
      existing.occurrences += 1;
      existing.confidence = Math.max(existing.confidence, Number(confidence.toFixed(4)));
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = severity;
      }
      existing.taskIds = [...new Set([...existing.taskIds, ...uniqueTasks])]
        .slice(0, this.maxTasksPerFinding);
      existing.lastDetectedLedger = Math.max(existing.lastDetectedLedger, ledger);
      // `detectedAtLedger` records when this finding was FIRST raised, so the
      // reported detection latency stays the latency of the first censored
      // round instead of growing as the behaviour repeats.
      if (first < existing.firstLedger) {
        existing.firstLedger = first;
        existing.detectedAtLedger = Math.max(existing.detectedAtLedger, ledger);
        existing.detectionLatencyLedgers = existing.detectedAtLedger - existing.firstLedger;
        existing.withinDetectionWindow = existing.detectionLatencyLedgers
          <= this.detectionWindowLedgers;
      }
      existing.corroboratingSources = [...new Set([
        ...existing.corroboratingSources,
        ...corroboratingSources,
      ])];
      existing.lastDetectedAt = arrivedAt;
      existing.observations = this._mergeObservations(
        existing.observations,
        sanitizedObservations,
      );
      existing.details = { ...existing.details, ...details, updatedLedger: ledger };
      existing.evidenceCompiled = false;
      this.emit('finding:updated', this._publicFinding(existing));
      return existing;
    }

    const id = sha256Hex(key).slice(0, 32);
    const finding = {
      id,
      key,
      type,
      pattern,
      severity,
      subjects: uniqueSubjects,
      taskIds: uniqueTasks,
      epoch,
      firstLedger: first,
      detectedAtLedger: ledger,
      lastDetectedLedger: ledger,
      detectionLatencyLedgers: ledger - first,
      withinDetectionWindow: (ledger - first) <= this.detectionWindowLedgers,
      confidence: Number(confidence.toFixed(4)),
      corroboratingSources: [...new Set(corroboratingSources.filter(Boolean))],
      occurrences: 1,
      firstDetectedAt: arrivedAt,
      lastDetectedAt: arrivedAt,
      summary: summary || `${type} detected for ${uniqueSubjects.join(', ')}`,
      details,
      observations: sanitizedObservations,
      evidenceCompiled: false,
      requiresExternalArbitration: true,
    };

    this.findings.set(id, finding);
    this.findingsByKey.set(key, id);
    this.stats.findings += 1;
    this._enforceFindingCap();
    this.emit('finding', this._publicFinding(finding));

    if (this.autoSubmitEvidence && this.evidenceSubmitter) {
      try {
        const submission = this.buildSlashingSubmission(id);
        Promise.resolve(this.evidenceSubmitter(submission)).catch((error) => {
          this.logger.warn('Byzantine evidence submission failed', {
            error: error.message,
            findingId: id,
          });
        });
      } catch (error) {
        this.logger.warn('Byzantine evidence compilation failed', {
          error: error.message,
          findingId: id,
        });
      }
    }

    this.logger.warn('Byzantine fault detected', {
      type,
      pattern,
      severity,
      subjects: uniqueSubjects,
      taskIds: uniqueTasks,
      detectionLatencyLedgers: finding.detectionLatencyLedgers,
    });

    return finding;
  }

  _mergeObservations(existing, incoming) {
    const merged = new Map();
    for (const observation of [...existing, ...incoming]) {
      if (observation && observation.id && !merged.has(observation.id)) {
        merged.set(observation.id, observation);
      }
    }
    return [...merged.values()].slice(-this.maxEvidenceObservations);
  }

  _publicFinding(finding) {
    return {
      id: finding.id,
      type: finding.type,
      pattern: finding.pattern,
      severity: finding.severity,
      subjects: [...finding.subjects],
      taskIds: [...finding.taskIds],
      epoch: finding.epoch,
      firstLedger: finding.firstLedger,
      detectedAtLedger: finding.detectedAtLedger,
      lastDetectedLedger: finding.lastDetectedLedger,
      detectionLatencyLedgers: finding.detectionLatencyLedgers,
      withinDetectionWindow: finding.withinDetectionWindow,
      confidence: finding.confidence,
      corroboratingSources: [...finding.corroboratingSources],
      occurrences: finding.occurrences,
      firstDetectedAt: finding.firstDetectedAt,
      lastDetectedAt: finding.lastDetectedAt,
      summary: finding.summary,
      details: { ...finding.details },
      observationCount: finding.observations.length,
      evidenceCompiled: finding.evidenceCompiled,
      requiresExternalArbitration: finding.requiresExternalArbitration,
    };
  }

  /**
   * @param {{type?: string, subjectId?: string, pattern?: string, minConfidence?: number, withinDetectionWindow?: boolean}} [filter]
   * @returns {Array<Object>} public finding summaries (no raw observations)
   */
  getFindings(filter = {}) {
    let findings = [...this.findings.values()];
    if (filter.type) {
      findings = findings.filter((finding) => finding.type === filter.type);
    }
    if (filter.pattern) {
      findings = findings.filter((finding) => finding.pattern === filter.pattern);
    }
    if (filter.subjectId) {
      findings = findings.filter((finding) => finding.subjects.includes(filter.subjectId));
    }
    if (typeof filter.minConfidence === 'number') {
      findings = findings.filter((finding) => finding.confidence >= filter.minConfidence);
    }
    if (typeof filter.withinDetectionWindow === 'boolean') {
      findings = findings.filter(
        (finding) => finding.withinDetectionWindow === filter.withinDetectionWindow,
      );
    }
    return findings
      .sort((a, b) => b.lastDetectedAt - a.lastDetectedAt)
      .map((finding) => this._publicFinding(finding));
  }

  /** Full finding, including the raw observations used as evidence. */
  getFinding(findingId) {
    const finding = this.findings.get(findingId);
    if (!finding) {
      return null;
    }
    return {
      ...this._publicFinding(finding),
      observations: [...finding.observations],
    };
  }

  /** Per-peer behavioural risk score in [0, 1]. */
  getPeerSuspicion(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return { peerId, known: false, riskScore: 0, counters: null };
    }
    const riskScore = clamp(
      0.5 * peer.equivocations
        + 0.25 * peer.roundsWithheldResults
        + 0.2 * peer.roundsWithheld
        + 0.15 * peer.contraryTasks.size
        + 0.05 * peer.lateVotes,
      0,
      1,
    );
    return {
      peerId,
      known: true,
      riskScore: Number(riskScore.toFixed(4)),
      lastSeenAt: peer.lastSeenAt,
      lastSeenLedger: peer.lastSeenLedger,
      counters: {
        observations: peer.observations,
        heartbeats: peer.heartbeats,
        votes: peer.votes,
        rejections: peer.rejections,
        commits: peer.commits,
        results: peer.results,
        lateVotes: peer.lateVotes,
        equivocations: peer.equivocations,
        roundsWithheld: peer.roundsWithheld,
        roundsWithheldResults: peer.roundsWithheldResults,
        contraryTasks: peer.contraryTasks.size,
      },
    };
  }

  getStats() {
    const byType = {};
    const bySeverity = {};
    for (const finding of this.findings.values()) {
      byType[finding.type] = (byType[finding.type] || 0) + 1;
      bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    }
    return {
      keeperId: this.keeperId,
      currentLedger: this.getCurrentLedger(),
      tipLedger: this.tipLedger,
      peers: this.peers.size,
      trackedRounds: this.rounds.size,
      pendingRounds: this.pendingRounds.size,
      trackedFindings: this.findings.size,
      trackedTaskSuspicions: this.taskSuspicion.size,
      trackedCoOffenses: this.coOffenses.size,
      byType,
      bySeverity,
      counters: { ...this.stats },
      policy: {
        ledgerDurationMs: this.ledgerDurationMs,
        detectionWindowLedgers: this.detectionWindowLedgers,
        voteGraceLedgers: this.voteGraceLedgers,
        resultGraceLedgers: this.resultGraceLedgers,
        minConfidence: this.minConfidence,
        minIndependentSources: this.minIndependentSources,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Cryptographic evidence
  // -------------------------------------------------------------------------

  _evidenceObservation(observation, index) {
    const record = {
      index,
      sourceId: observation.sourceId,
      channel: observation.channel,
      kind: observation.kind,
      messageId: observation.messageId,
      taskId: observation.taskId,
      epoch: observation.epoch,
      ledger: observation.ledger,
      sentAt: observation.sentAt,
      arrivedAt: observation.arrivedAt,
      vote: observation.vote,
      executorId: observation.executorId,
      success: observation.success,
      signature: observation.signature,
      signatureVerified: observation.signatureVerified,
      identityMismatch: observation.identityMismatch,
      payloadDigest: observation.payloadDigest,
    };
    return { ...record, digest: sha256Hex(record) };
  }

  /**
   * Compile a slashing-grade evidence bundle for a finding.
   *
   * @param {string} findingId
   * @param {{signingKey?: any, publicKey?: any, hmacSecret?: string}} [options]
   * @returns {Object} signed evidence bundle
   */
  compileEvidence(findingId, options = {}) {
    const finding = this.findings.get(findingId);
    if (!finding) {
      throw new Error(`Unknown byzantine finding: ${findingId}`);
    }

    const observations = finding.observations
      .slice(-this.maxEvidenceObservations)
      .map((observation, index) => this._evidenceObservation(observation, index));

    const findingPayload = {
      findingId: finding.id,
      type: finding.type,
      pattern: finding.pattern,
      severity: finding.severity,
      subjects: [...finding.subjects],
      taskIds: [...finding.taskIds],
      epoch: finding.epoch,
      firstLedger: finding.firstLedger,
      detectedAtLedger: finding.detectedAtLedger,
      lastDetectedLedger: finding.lastDetectedLedger,
      detectionLatencyLedgers: finding.detectionLatencyLedgers,
      withinDetectionWindow: finding.withinDetectionWindow,
      confidence: finding.confidence,
      occurrences: finding.occurrences,
      corroboratingSources: [...finding.corroboratingSources],
      details: finding.details,
    };

    const observationDigests = observations.map((observation) => observation.digest);
    const merkleRoot = computeMerkleRoot(observationDigests);
    const findingDigest = sha256Hex(findingPayload);

    const signedObservations = observations.every(
      (observation) => observation.signatureVerified === true,
    );
    const corroborated = [
      DETECTION_TYPES.EQUIVOCATION,
      DETECTION_TYPES.FRONT_RUNNING,
      DETECTION_TYPES.IDENTITY_SPOOFING,
    ].includes(finding.type)
      || finding.corroboratingSources.length >= this.minIndependentSources;
    const slashingGrade = observations.length > 0 && signedObservations && corroborated;

    const unsigned = {
      version: PROTOCOL_VERSION,
      bundleId: crypto.randomUUID(),
      detectorId: this.keeperId,
      findingId: finding.id,
      finding: findingPayload,
      policy: {
        detectionWindowLedgers: this.detectionWindowLedgers,
        voteGraceLedgers: this.voteGraceLedgers,
        resultGraceLedgers: this.resultGraceLedgers,
        minIndependentSources: this.minIndependentSources,
        quorumPolicy: `>=${this.minIndependentSources} independent observers or cryptographic contradiction`,
        requiresExternalArbitration: true,
      },
      observations,
      observationDigests,
      merkleRoot,
      findingDigest,
      slashingGrade,
      issuedAt: new Date(this.clock.now()).toISOString(),
    };

    // The signature must cover the algorithm descriptor and public key too,
    // otherwise a bundle could be re-labelled after signing.
    const signer = this._signingConfig(options);
    const signedPayload = {
      ...unsigned,
      algorithm: signer.algorithm,
      publicKey: signer.publicKey,
    };
    const signature = signer.sign(Buffer.from(canonicalize(signedPayload), 'utf8'));
    const bundle = { ...signedPayload, signature };

    finding.evidenceCompiled = true;
    this.stats.evidence += 1;
    this.emit('evidence', { findingId: finding.id, bundle });
    return bundle;
  }

  _signingConfig(options = {}) {
    const signingKey = options.signingKey || this.signingKey;
    if (signingKey) {
      const privateKey = resolvePrivateKey(signingKey);
      const publicKey = options.publicKey
        || crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
      return {
        algorithm: {
          hash: 'sha256',
          signature: 'ed25519',
          canonicalization: 'sorted-json-v1',
        },
        publicKey,
        sign: (data) => crypto.sign(null, data, privateKey).toString('base64'),
      };
    }

    const hmacSecret = options.hmacSecret || this.hmacSecret;
    if (hmacSecret) {
      return {
        algorithm: {
          hash: 'sha256',
          signature: 'hmac-sha256',
          canonicalization: 'sorted-json-v1',
        },
        publicKey: null,
        sign: (data) => crypto.createHmac('sha256', hmacSecret).update(data).digest('hex'),
      };
    }

    throw new Error(
      'Evidence signing requires an Ed25519 signingKey or an hmacSecret',
    );
  }

  /**
   * Wrap an evidence bundle in an on-chain slashing recommendation. Penalties
   * are suggestions only; `requiresGovernanceApproval` keeps the decision with
   * the network rather than with a single detecting keeper.
   */
  buildSlashingSubmission(findingId, options = {}) {
    const finding = this.findings.get(findingId);
    if (!finding) {
      throw new Error(`Unknown byzantine finding: ${findingId}`);
    }
    const evidence = this.compileEvidence(findingId, options);
    const basePenalty = SLASHING_PENALTY_BPS[finding.type] || 1000;
    return {
      submissionId: `slash:${evidence.bundleId}`,
      createdAt: evidence.issuedAt,
      findingId: finding.id,
      evidence,
      targets: finding.subjects.map((keeperId) => ({
        keeperId,
        weight: finding.confidence,
        suggestedPenaltyBps: Math.round(basePenalty * finding.confidence),
      })),
      justification: finding.summary,
      requiresGovernanceApproval: true,
      arbitration: 'on-chain-governance',
      slashingGrade: evidence.slashingGrade,
    };
  }

  /** Hand a compiled submission to the configured on-chain submitter. */
  async submitEvidence(findingId, options = {}) {
    if (typeof this.evidenceSubmitter !== 'function') {
      throw new Error('No evidenceSubmitter configured');
    }
    const submission = this.buildSlashingSubmission(findingId, options);
    return this.evidenceSubmitter(submission);
  }

  // -------------------------------------------------------------------------
  // Network attachment / lifecycle
  // -------------------------------------------------------------------------

  attachToNetwork(network) {
    if (!network || typeof network.attachByzantineDetector !== 'function') {
      throw new Error('Network must expose attachByzantineDetector(detector)');
    }
    network.attachByzantineDetector(this);
    this.network = network;
    return this;
  }

  detach() {
    if (this.network && typeof this.network.detachByzantineDetector === 'function') {
      this.network.detachByzantineDetector();
    }
    this.network = null;
    return this;
  }

  shutdown() {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    this.pendingRounds.clear();
    this.rounds.clear();
    this.findings.clear();
    this.findingsByKey.clear();
    this.taskSuspicion.clear();
    this.coOffenses.clear();
    this.peers.clear();
    this.removeAllListeners();
    this.logger.info('Byzantine detector shutdown');
  }

  // -------------------------------------------------------------------------
  // Bounded state helpers
  // -------------------------------------------------------------------------

  _enforceRoundCap() {
    while (this.rounds.size > this.maxRounds) {
      const oldestKey = this.rounds.keys().next().value;
      this.rounds.delete(oldestKey);
      this.pendingRounds.delete(oldestKey);
    }
  }

  _enforceMapCap(map, limit) {
    while (map.size > limit) {
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
    }
  }

  _enforceFindingCap() {
    while (this.findings.size > this.maxFindings) {
      let victim = null;
      for (const finding of this.findings.values()) {
        if (
          !victim
          || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[victim.severity]
          || (
            SEVERITY_RANK[finding.severity] === SEVERITY_RANK[victim.severity]
            && finding.lastDetectedAt < victim.lastDetectedAt
          )
        ) {
          victim = finding;
        }
      }
      if (!victim) {
        break;
      }
      this.findings.delete(victim.id);
      if (this.findingsByKey.get(victim.key) === victim.id) {
        this.findingsByKey.delete(victim.key);
      }
    }
  }
}

module.exports = ByzantineDetector;
module.exports.ByzantineDetector = ByzantineDetector;
module.exports.DETECTION_TYPES = DETECTION_TYPES;
module.exports.DETECTION_SEVERITY = DETECTION_SEVERITY;
module.exports.DETECTION_POLICY = DETECTION_POLICY;
module.exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
module.exports.verifyEvidence = verifyEvidence;
module.exports.canonicalize = canonicalize;
module.exports.computeMerkleRoot = computeMerkleRoot;
module.exports.generateSigningKeyPair = generateSigningKeyPair;

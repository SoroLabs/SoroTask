'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

const DEFAULT_EPOCH_DURATION_MS = 60_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const DEFAULT_CLAIM_WINDOW_MS = 75;
const DEFAULT_VRF_SEED = 'sorotask-keeper-gossip-v2';

class VRFResolver {
  constructor(seed = DEFAULT_VRF_SEED) {
    this.seed = seed;
  }

  getPriority(taskId, epoch, peerId) {
    const digest = crypto
      .createHmac('sha256', this.seed)
      .update(`${String(taskId)}:${epoch}:${String(peerId)}`)
      .digest();
    return digest.readUInt32BE(0);
  }
}

class GossipSubNetworkV2 extends EventEmitter {
  constructor(network, options = {}) {
    super();
    if (!network || typeof network.broadcastTaskClaim !== 'function') {
      throw new TypeError('A KeeperP2PNetwork with task-claim support is required');
    }

    this.network = network;
    this.epochDurationMs = options.epochDurationMs || DEFAULT_EPOCH_DURATION_MS;
    this.claimTtlMs = options.claimTtlMs || DEFAULT_CLAIM_TTL_MS;
    this.claimWindowMs = options.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS;
    this.now = options.now || Date.now;
    this.vrf = options.vrf || new VRFResolver(options.vrfSeed || network.sharedSecret);
    this.claims = new Map();
    this.started = false;
    this.onTaskClaim = (envelope) => this.recordClaim(envelope);
  }

  start() {
    if (this.started) {
      return;
    }
    this.network.on('task-claim', this.onTaskClaim);
    this.started = true;
  }

  stop() {
    if (!this.started) {
      return;
    }
    this.network.off('task-claim', this.onTaskClaim);
    this.started = false;
    this.claims.clear();
  }

  async claimTask(taskId) {
    if (!this.started || !this.network.started) {
      return { claimed: false, reason: 'network_not_started' };
    }
    if (taskId == null || String(taskId).length === 0) {
      throw new TypeError('taskId is required');
    }

    const now = this.now();
    const normalizedTaskId = String(taskId);
    const epoch = Math.floor(now / this.epochDurationMs);
    const claim = {
      taskId: normalizedTaskId,
      epoch,
      priority: this.vrf.getPriority(normalizedTaskId, epoch, this.network.nodeId),
      expiresAt: now + this.claimTtlMs,
    };

    const envelope = this.network.broadcastTaskClaim(claim);
    if (!envelope) {
      return { claimed: false, reason: 'network_not_started' };
    }

    await new Promise((resolve) => setTimeout(resolve, this.claimWindowMs));
    this.pruneExpiredClaims(this.now());

    const key = this.getClaimKey(normalizedTaskId, epoch);
    const contenders = this.claims.get(key);
    if (!contenders || contenders.size === 0) {
      return { claimed: false, reason: 'claim_not_propagated', epoch };
    }

    const winner = this.getWinner(contenders);
    return {
      claimed: winner.peerId === this.network.nodeId,
      winner: winner.peerId,
      priority: claim.priority,
      epoch,
      claimCount: contenders.size,
    };
  }

  recordClaim(envelope) {
    const payload = envelope && envelope.payload;
    const now = this.now();
    if (
      !this.started
      || !envelope
      || !envelope.nodeId
      || !payload
      || payload.taskId == null
      || !Number.isSafeInteger(payload.epoch)
      || !Number.isSafeInteger(payload.priority)
      || payload.priority < 0
      || payload.priority > 0xffffffff
      || payload.epoch !== Math.floor(now / this.epochDurationMs)
      || String(payload.taskId).length === 0
      || String(payload.taskId).length > 256
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= now
      || payload.expiresAt > now + this.claimTtlMs
      || this.vrf.getPriority(payload.taskId, payload.epoch, envelope.nodeId) !== payload.priority
    ) {
      return false;
    }

    this.pruneExpiredClaims(now);
    const key = this.getClaimKey(String(payload.taskId), payload.epoch);
    if (!this.claims.has(key)) {
      this.claims.set(key, new Map());
    }

    const contenders = this.claims.get(key);
    const previousWinner = contenders.size > 0 ? this.getWinner(contenders).peerId : null;
    contenders.set(envelope.nodeId, {
      peerId: envelope.nodeId,
      priority: payload.priority,
      expiresAt: payload.expiresAt,
    });

    const winner = this.getWinner(contenders);
    const claim = {
      taskId: String(payload.taskId),
      epoch: payload.epoch,
      winner: winner.peerId,
      claimCount: contenders.size,
    };
    this.emit('claim:updated', claim);
    if (previousWinner === this.network.nodeId && winner.peerId !== this.network.nodeId) {
      this.emit('claim:lost', claim);
    }
    return true;
  }

  pruneExpiredClaims(now = this.now()) {
    for (const [key, contenders] of this.claims) {
      for (const [peerId, claim] of contenders) {
        if (claim.expiresAt <= now) {
          contenders.delete(peerId);
        }
      }
      if (contenders.size === 0) {
        this.claims.delete(key);
      }
    }
  }

  getNetworkState() {
    this.pruneExpiredClaims();
    return {
      peerId: this.network.nodeId,
      epoch: Math.floor(this.now() / this.epochDurationMs),
      peers: this.network.getHealthyPeers().length,
      activeClaims: this.claims.size,
      claimCount: Array.from(this.claims.values())
        .reduce((total, contenders) => total + contenders.size, 0),
    };
  }

  getClaimKey(taskId, epoch) {
    return `${epoch}:${taskId}`;
  }

  getWinner(contenders) {
    return Array.from(contenders.values()).sort((left, right) => (
      left.priority - right.priority
      || left.peerId.localeCompare(right.peerId)
    ))[0];
  }
}

module.exports = {
  DEFAULT_CLAIM_TTL_MS,
  DEFAULT_EPOCH_DURATION_MS,
  GossipSubNetworkV2,
  VRFResolver,
};

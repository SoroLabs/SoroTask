'use strict';
const crypto = require('crypto');

class VRFResolver {
  constructor(seed) { this.seed = seed; }
  getPriority(taskId, epoch, peerId) {
    return crypto.createHash('sha256').update(`${this.seed}:${taskId}:${epoch}:${peerId}`).readUInt32BE(0);
  }
}

class GossipSubNetworkV2 {
  constructor() {
    this.peers = new Map();
    this.claims = new Map();
    this.epoch = 0;
    this.peerId = crypto.randomBytes(20).toString('hex');
    this.vrf = new VRFResolver(crypto.randomBytes(32).toString('hex'));
  }
  addPeer(id, meta = {}) { this.peers.set(id, { id, lastSeen: Date.now(), ...meta }); }
  claimTask(taskId) {
    const priority = this.vrf.getPriority(taskId, this.epoch, this.peerId);
    this.claims.set(taskId, { peerId: this.peerId, priority, timestamp: Date.now() });
    return { claimed: true, priority };
  }
  getNetworkState() {
    return { peerId: this.peerId, epoch: this.epoch, peers: this.peers.size, claims: this.claims.size };
  }
}
module.exports = { GossipSubNetworkV2, VRFResolver };

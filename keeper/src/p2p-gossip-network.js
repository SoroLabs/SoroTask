'use strict';

const net = require('net');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const {
  NoiseHandshake,
  NoiseSession,
  exportRawPublicKey,
} = require('./crypto/noise');

const DEFAULT_CONFIG = {
  listenAddr: '/ip4/0.0.0.0/tcp/4001',
  bootstrapPeers: [],
  gossipTopic: 'sorotask/keeper/assignments',
  heartbeatIntervalMs: 10000,
  maxPeers: 50,
  epochDurationMs: 60000,
  vrfSeed: process.env.KEEPER_VRF_SEED || crypto.randomBytes(32).toString('hex'),
  // Kademlia DHT tuning (issue #1470)
  kBucketSize: 8,
  lookupConcurrency: 3,
  maxLookupRounds: 8,
  // Sybil mitigation: contacts below this proof-of-stake stake are rejected.
  minStake: Number(process.env.KEEPER_MIN_STAKE || 0),
  enableTcpMesh: true,
  allowedPeerIdentities: null, // null = allow any valid ed25519 identity, or Set/Array of hex keys
};

/**
 * Kademlia node identity: SHA-256 of the raw peer id -> 256-bit identifier.
 */
function nodeIdHash(rawId) {
  return crypto.createHash('sha256').update(String(rawId)).digest('hex');
}

/**
 * XOR distance between two 256-bit hex identifiers.
 */
function xorDistance(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  const len = Math.min(a.length, b.length);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

/**
 * Compare XOR distances of aHex and bHex to targetHex (-1, 0, 1).
 */
function compareDistance(aHex, bHex, targetHex) {
  return xorDistance(aHex, targetHex).compare(xorDistance(bHex, targetHex));
}

/**
 * Number of leading bits shared by two identifiers (0..256).
 * Used to select the k-bucket index for a contact.
 */
function sharedPrefixLength(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  let bits = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ^ b[i];
    if (x === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(x) - 24;
    break;
  }
  return bits;
}

/**
 * One k-bucket: holds up to `k` contacts for a single distance prefix.
 * Contacts are kept least-recently-seen first; stale contacts are evicted
 * before newer ones are dropped (classic Kademlia replacement policy).
 */
class KBucket {
  constructor(k, staleAfterMs = 60000) {
    this.k = k;
    this.staleAfterMs = staleAfterMs;
    this.contacts = []; // sorted by lastSeen ascending (head = least recent)
  }

  add(contact) {
    const now = Date.now();
    const existing = this.contacts.find((c) => c.id === contact.id);
    if (existing) {
      existing.lastSeen = now;
      if (contact.stake != null) existing.stake = contact.stake;
      return { added: true, updated: true };
    }

    if (this.contacts.length < this.k) {
      this.contacts.push({ ...contact, lastSeen: contact.lastSeen || now });
      return { added: true };
    }

    // Bucket full: evict the head only when it is stale, otherwise reject
    // the newcomer (Kademlia keeps long-lived nodes in the table).
    const head = this.contacts[0];
    if (now - head.lastSeen > this.staleAfterMs) {
      this.contacts.shift();
      this.contacts.push({ ...contact, lastSeen: contact.lastSeen || now });
      return { added: true, evicted: head.id };
    }
    return { added: false, reason: 'bucket_full' };
  }

  remove(id) {
    const before = this.contacts.length;
    this.contacts = this.contacts.filter((c) => c.id !== id);
    return before !== this.contacts.length;
  }

  size() {
    return this.contacts.length;
  }
}

/**
 * Kademlia routing table: 256 k-buckets indexed by shared prefix length
 * between the local node id hash and the contact id hash.
 */
class KademliaTable {
  constructor(selfId, options = {}) {
    this.selfHash = nodeIdHash(selfId);
    this.k = options.k || 8;
    this.minStake = options.minStake || 0;
    this.staleAfterMs = options.staleAfterMs || 60000;
    this.buckets = Array.from({ length: 256 }, () => new KBucket(this.k, this.staleAfterMs));
  }

  /**
   * Insert a peer. Sybil gate: proof-of-stake below minStake is rejected
   * so an attacker cannot flood the table with cheap identities.
   */
  add(contact, meta = {}) {
    if (!contact || !contact.id) return { added: false, reason: 'invalid_contact' };
    const hash = nodeIdHash(contact.id);
    if (hash === this.selfHash) return { added: false, reason: 'self' };
    if (this.minStake > 0 && Number(contact.stake || 0) < this.minStake) {
      return { added: false, reason: 'insufficient_stake' };
    }
    const idx = sharedPrefixLength(this.selfHash, hash);
    const result = this.buckets[idx].add({
      id: contact.id,
      address: contact.address || meta.address || null,
      stake: Number(contact.stake || 0),
      lastSeen: Date.now(),
    });
    return result;
  }

  remove(id) {
    const idx = sharedPrefixLength(this.selfHash, nodeIdHash(id));
    return this.buckets[idx].remove(id);
  }

  size() {
    return this.buckets.reduce((sum, b) => sum + b.size(), 0);
  }

  /**
   * All contacts, ordered by XOR distance to targetId.
   */
  closest(targetId, count = this.k) {
    const targetHash = nodeIdHash(targetId);
    const all = this.buckets.flatMap((b) => b.contacts.slice());
    all.sort((a, b) => compareDistance(nodeIdHash(a.id), nodeIdHash(b.id), targetHash));
    return all.slice(0, count);
  }
}


function parseMultiaddr(addr) {
  if (typeof addr === 'number') {
    return { host: '127.0.0.1', port: addr };
  }
  if (typeof addr !== 'string') {
    return { host: '127.0.0.1', port: 0 };
  }
  // Matches /ip4/127.0.0.1/tcp/4001 or 127.0.0.1:4001
  const ip4Match = addr.match(/\/ip4\/([^/]+)\/tcp\/(\d+)/);
  if (ip4Match) {
    return { host: ip4Match[1], port: parseInt(ip4Match[2], 10) };
  }
  const hostPortMatch = addr.match(/^([^:]+):(\d+)$/);
  if (hostPortMatch) {
    return { host: hostPortMatch[1], port: parseInt(hostPortMatch[2], 10) };
  }
  return { host: '0.0.0.0', port: 4001 };
}

class VRFResolver {
  constructor(seed) {
    this.seed = seed;
  }

  getDeterministicPriority(taskId, epoch, peerId) {
    const input = `${this.seed}:${taskId}:${epoch}:${peerId}`;
    const hash = crypto.createHash('sha256').update(input).digest();
    return hash.readUInt32BE(0);
  }

  getEpochSeed(epoch) {
    return crypto.createHash('sha256').update(`${this.seed}:${epoch}`).digest('hex');
  }
}

class GossipSubNetwork {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('p2p-gossip-network');
    this.peers = new Map();
    this.peerSockets = new Map();
    this.taskClaims = new Map();
    this.vrf = new VRFResolver(this.config.vrfSeed);
    this.currentEpoch = Math.floor(Date.now() / this.config.epochDurationMs);
    this.isRunning = false;

    // Cryptographic node identity (Ed25519 static identity and X25519 static DH)
    this.ed25519Keypair = this.config.ed25519Keypair || crypto.generateKeyPairSync('ed25519');
    this.staticDhKeypair = this.config.staticDhKeypair || crypto.generateKeyPairSync('x25519');
    this.rawEd25519Pub = exportRawPublicKey(this.ed25519Keypair.publicKey);
    this.peerId = this.config.peerId || this.rawEd25519Pub.toString('hex');

    this.allowedPeerIdentities = this.config.allowedPeerIdentities
      ? new Set(this.config.allowedPeerIdentities)
      : null;

    this.server = null;
    this.actualPort = null;
    this.incomingSockets = new Set();

    // Kademlia routing table (issue #1470): dynamic k-buckets replace the
    // hardcoded bootstrap list as the source of peer contacts.
    this.routingTable = new KademliaTable(this.peerId, {
      k: this.config.kBucketSize,
      minStake: this.config.minStake,
      staleAfterMs: this.config.heartbeatIntervalMs * 3,
    });
    // Optional async transport: (peerId, targetId) => [{id, address, stake}]
    // Injected by the network adapter; without it lookups use gossip only.
    this.onFindNodeQuery = this.config.onFindNodeQuery || null;  }

  async start() {
    this.isRunning = true;
    this.logger.info('Starting P2P GossipSub network', {
      peerId: this.peerId,
      listenAddr: this.config.listenAddr,
    });

    if (this.config.enableTcpMesh) {
      await this.startTcpServer();
      if (Array.isArray(this.config.bootstrapPeers)) {
        for (const peerAddr of this.config.bootstrapPeers) {
          this.connectToPeer(peerAddr).catch((err) => {
            this.logger.debug('Failed to connect to bootstrap peer', { peerAddr, error: err.message });
          });
        }
      }
    }

    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.config.heartbeatIntervalMs);

    this.epochTimer = setInterval(() => {
      this.advanceEpoch();
    }, this.config.epochDurationMs);
  }

  startTcpServer() {
    return new Promise((resolve) => {
      const { host, port } = parseMultiaddr(this.config.listenAddr);

      this.server = net.createServer((socket) => {
        this.handleIncomingConnection(socket);
      });

      this.server.on('error', (err) => {
        this.logger.error('TCP server error', { error: err.message });
      });

      this.server.listen(port, host, () => {
        const addr = this.server.address();
        this.actualPort = typeof addr === 'object' && addr ? addr.port : port;
        this.logger.info('TCP Gossip mesh listening', { host, port: this.actualPort });
        resolve(this.actualPort);
      });
    });
  }

  async connectToPeer(peerAddr) {
    if (!this.isRunning) return null;
    const { host, port } = parseMultiaddr(peerAddr);

    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port }, async () => {
        try {
          const handshake = new NoiseHandshake({
            isInitiator: true,
            ed25519Keypair: this.ed25519Keypair,
            staticDhKeypair: this.staticDhKeypair,
            allowedPeerIdentities: this.allowedPeerIdentities,
          });

          // Send Message 1
          const msg1 = handshake.createMessage1();
          this.writeLengthPrefixedFrame(socket, msg1);

          let buffer = Buffer.alloc(0);

          const onData = (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= 4) {
              const frameLen = buffer.readUInt32BE(0);
              if (buffer.length < 4 + frameLen) break;

              const frame = buffer.subarray(4, 4 + frameLen);
              buffer = buffer.subarray(4 + frameLen);

              if (!handshake.isComplete) {
                if (handshake.state === 'INITIATOR_WAIT_MSG2') {
                  handshake.processMessage2(frame);
                  const msg3 = handshake.createMessage3();
                  this.writeLengthPrefixedFrame(socket, msg3);

                  // Handshake completed!
                  const peerNodeId = exportRawPublicKey(handshake.peerEd25519Pub).toString('hex');
                  this.registerSecurePeer(peerNodeId, socket, handshake.session);
                  resolve(peerNodeId);
                }
              } else {
                // Application gossip message
                this.handleEncryptedData(socket, handshake.session, frame);
              }
            }
          };

          socket.on('data', onData);
          socket.on('error', (err) => {
            this.logger.debug('Peer socket error', { peerAddr, error: err.message });
          });
          socket.on('close', () => {
            this.cleanupSocket(socket);
          });
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  handleIncomingConnection(socket) {
    this.incomingSockets.add(socket);
    let handshake = null;
    let buffer = Buffer.alloc(0);

    try {
      handshake = new NoiseHandshake({
        isInitiator: false,
        ed25519Keypair: this.ed25519Keypair,
        staticDhKeypair: this.staticDhKeypair,
        allowedPeerIdentities: this.allowedPeerIdentities,
      });
    } catch (_err) {
      socket.destroy();
      return;
    }

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        while (buffer.length >= 4) {
          const frameLen = buffer.readUInt32BE(0);
          if (buffer.length < 4 + frameLen) break;

          const frame = buffer.subarray(4, 4 + frameLen);
          buffer = buffer.subarray(4 + frameLen);

          if (!handshake.isComplete) {
            if (handshake.state === 'RESPONDER_WAIT_MSG1') {
              handshake.processMessage1(frame);
              const msg2 = handshake.createMessage2();
              this.writeLengthPrefixedFrame(socket, msg2);
            } else if (handshake.state === 'RESPONDER_WAIT_MSG3') {
              handshake.processMessage3(frame);
              // Handshake complete on responder
              const peerNodeId = exportRawPublicKey(handshake.peerEd25519Pub).toString('hex');
              this.registerSecurePeer(peerNodeId, socket, handshake.session);
            }
          } else {
            this.handleEncryptedData(socket, handshake.session, frame);
          }
        }
      } catch (err) {
        this.logger.warn('Handshake failed or unauthorized peer rejected', {
          error: err.message,
        });
        socket.destroy();
      }
    });

    socket.on('error', () => {
      this.cleanupSocket(socket);
    });

    socket.on('close', () => {
      this.cleanupSocket(socket);
    });
  }

  writeLengthPrefixedFrame(socket, payload) {
    if (socket && !socket.destroyed) {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length, 0);
      socket.write(Buffer.concat([header, payload]));
    }
  }

  registerSecurePeer(peerId, socket, noiseSession) {
    this.addPeer(peerId, { secure: true, transport: 'noise_tcp' });
    this.peerSockets.set(peerId, { socket, noiseSession });
    socket._peerId = peerId;
    this.logger.info('Secure peer connected with forward-secret channel', { peerId });
  }

  cleanupSocket(socket) {
    this.incomingSockets.delete(socket);
    if (socket._peerId) {
      this.peerSockets.delete(socket._peerId);
      this.removePeer(socket._peerId);
    }
  }

  handleEncryptedData(socket, noiseSession, ciphertext) {
    try {
      const plaintext = noiseSession.decrypt(ciphertext);
      const message = JSON.parse(plaintext.toString('utf8'));
      this.handleGossipMessage(message);
    } catch (err) {
      this.logger.warn('Failed to decrypt gossip frame; dropping corrupted packet', {
        error: err.message,
      });
    }
  }

  async stop() {
    this.isRunning = false;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.epochTimer);

    for (const s of this.incomingSockets) {
      try {
        s.destroy();
      } catch (_e) {
        // ignore socket cleanup error
      }
    }
    this.incomingSockets.clear();

    for (const [, entry] of this.peerSockets) {
      if (entry.socket && !entry.socket.destroyed) {
        entry.socket.destroy();
      }
    }
    this.peerSockets.clear();

    if (this.server) {
      try {
        this.server.close();
      } catch (_e) {
        // ignore server close error
      }
      this.server = null;
    }

    this.peers.clear();
    this.taskClaims.clear();
    this.logger.info('P2P network stopped');
  }

  heartbeat() {
    const now = Date.now();
    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > this.config.heartbeatIntervalMs * 3) {
        this.peers.delete(peerId);
        this.routingTable.remove(peerId);
        const entry = this.peerSockets.get(peerId);
        if (entry && entry.socket) entry.socket.destroy();
        this.peerSockets.delete(peerId);
        this.logger.debug('Peer timed out', { peerId });
      }
    }
    // Self-heal: refresh known contacts so stale buckets evict dead peers.
    for (const peer of this.peers.values()) {
      this.routingTable.add({ id: peer.id, stake: peer.metadata?.stake || 0 });
    }
  }

  advanceEpoch() {
    this.currentEpoch++;
    this.taskClaims.clear();
    this.logger.info('Epoch advanced', {
      epoch: this.currentEpoch,
      seed: this.vrf.getEpochSeed(this.currentEpoch).slice(0, 16),
    });
  }

  addPeer(peerId, metadata = {}) {
    if (this.peers.size >= this.config.maxPeers) {
      this.logger.warn('Max peers reached', { maxPeers: this.config.maxPeers });
      return false;
    }

    this.peers.set(peerId, {
      id: peerId,
      lastSeen: Date.now(),
      metadata,
      activeTasks: 0,
    });
    // Keep the k-buckets in sync with gossip-learned peers (issue #1470).
    this.routingTable.add({ id: peerId, stake: metadata.stake || 0 }, metadata);
    this.logger.debug('Peer added', { peerId });
    return true;
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this.routingTable.remove(peerId);
    this.logger.debug('Peer removed', { peerId });
  }

  claimTask(taskId) {
    const existingClaim = this.taskClaims.get(taskId);
    if (existingClaim) {
      this.logger.debug('Task already claimed', {
        taskId,
        claimant: existingClaim.peerId,
      });
      return { claimed: false, claimant: existingClaim.peerId };
    }

    const priority = this.vrf.getDeterministicPriority(
      taskId,
      this.currentEpoch,
      this.peerId
    );

    this.taskClaims.set(taskId, {
      peerId: this.peerId,
      priority,
      timestamp: Date.now(),
      epoch: this.currentEpoch,
    });

    this.logger.info('Task claimed', { taskId, priority });
    return { claimed: true, priority };
  }

  resolveConflict(taskId, competingClaims) {
    if (competingClaims.length === 0) {
      return null;
    }

    const sortedClaims = competingClaims.sort((a, b) => b.priority - a.priority);
    const winner = sortedClaims[0];

    this.logger.info('Conflict resolved', {
      taskId,
      winner: winner.peerId,
      priority: winner.priority,
      totalClaims: competingClaims.length,
    });

    return winner;
  }

  broadcastGossip(message) {
    const gossipMessage = {
      type: 'task_claim',
      peerId: this.peerId,
      epoch: this.currentEpoch,
      timestamp: Date.now(),
      ...message,
    };

    this.logger.debug('Broadcasting gossip', {
      type: gossipMessage.type,
      taskId: message.taskId,
    });

    // Send encrypted frame to every connected TCP peer
    const serialized = Buffer.from(JSON.stringify(gossipMessage), 'utf8');
    for (const [peerId, entry] of this.peerSockets) {
      if (entry.socket && !entry.socket.destroyed && entry.noiseSession) {
        try {
          const frame = entry.noiseSession.encodeFrame(serialized);
          entry.socket.write(frame);
        } catch (err) {
          this.logger.warn('Failed to send encrypted gossip to peer', { peerId, error: err.message });
        }
      }
    }

    return gossipMessage;
  }

  handleGossipMessage(message) {
    if (!message || message.peerId === this.peerId) {
      return null;
    }

    this.addPeer(message.peerId, { lastGossip: message.timestamp });

    switch (message.type) {
      case 'task_claim':
        return this.handleTaskClaim(message);
      case 'task_release':
        return this.handleTaskRelease(message);
      case 'heartbeat':
        return this.handleHeartbeat(message);
      case 'join':
        // Kademlia join announcement (issue #1470): learn the new node and
        // reply with our closest contacts so it can populate its k-buckets.
        this.addPeer(message.peerId, { lastGossip: message.timestamp });
        return {
          acknowledged: true,
          peerId: this.peerId,
          contacts: this.routingTable.closest(message.peerId, this.config.kBucketSize),
        };
      default:
        this.logger.warn('Unknown gossip message type', { type: message.type });
        return null;
    }
  }

  handleTaskClaim(message) {
    const { taskId, peerId, priority } = message;

    if (!this.taskClaims.has(taskId)) {
      this.taskClaims.set(taskId, {
        peerId,
        priority,
        timestamp: message.timestamp,
        epoch: message.epoch,
      });
      return { accepted: true };
    }

    const existing = this.taskClaims.get(taskId);
    if (priority > existing.priority) {
      this.taskClaims.set(taskId, {
        peerId,
        priority,
        timestamp: message.timestamp,
        epoch: message.epoch,
      });
      return { accepted: true, replaced: existing.peerId };
    }

    return { accepted: false, reason: 'lower_priority' };
  }

  handleTaskRelease(message) {
    const { taskId, peerId } = message;
    const claim = this.taskClaims.get(taskId);

    if (claim && claim.peerId === peerId) {
      this.taskClaims.delete(taskId);
      return { released: true };
    }

    return { released: false, reason: 'not_claimant' };
  }

  handleHeartbeat(_message) {
    return { acknowledged: true, peerId: this.peerId };
  }

  /**
   * Iterative Kademlia node lookup (alpha-parallel FIND_NODE rounds).
   * Returns the `k` closest contacts to targetId found across rounds.
   * Round 0 seeds from local k-buckets; later rounds query peers via
   * `onFindNodeQuery` when a transport is injected, otherwise from
   * gossip-learned peers only (no centralized bootstrap required).
   */
  async findNode(targetId, options = {}) {
    const alpha = options.concurrency || this.config.lookupConcurrency;
    const maxRounds = options.maxRounds || this.config.maxLookupRounds;
    const k = this.config.kBucketSize;

    const targetHash = nodeIdHash(targetId);
    const known = new Map(); // peerId -> contact
    for (const c of this.routingTable.closest(targetId, k)) known.set(c.id, c);
    for (const peer of this.peers.values()) known.set(peer.id, { id: peer.id, stake: peer.metadata?.stake || 0 });

    const queried = new Set();
    let best = this._sortedClosest([...known.values()], targetHash, k);

    for (let round = 0; round < maxRounds; round++) {
      const candidates = best
        .filter((c) => !queried.has(c.id))
        .slice(0, alpha);
      if (candidates.length === 0) break;

      const results = await Promise.all(
        candidates.map(async (c) => {
          queried.add(c.id);
          if (!this.onFindNodeQuery) return [];
          try {
            const res = await this.onFindNodeQuery(c.id, targetId);
            return Array.isArray(res) ? res : [];
          } catch {
            return [];
          }
        }),
      );

      let added = 0;
      for (const contact of results.flat()) {
        if (!contact || !contact.id || contact.id === this.peerId) continue;
        if (!known.has(contact.id)) added++;
        known.set(contact.id, contact);
        this.routingTable.add(contact);
      }
      const next = this._sortedClosest([...known.values()], targetHash, k);
      const improved =
        next.length > 0 &&
        best.length > 0 &&
        compareDistance(nodeIdHash(next[0].id), nodeIdHash(best[0].id), targetHash) < 0;
      best = next;
      if (!improved && added === 0) break; // converged
    }
    return best;
  }

  _sortedClosest(contacts, targetHash, count) {
    return contacts
      .slice()
      .sort((a, b) => compareDistance(nodeIdHash(a.id), nodeIdHash(b.id), targetHash))
      .slice(0, count);
  }

  /**
   * Join the cluster without centralized bootstrap servers (issue #1470).
   * Seeds are optional: any combination of configured peers, previously
   * known peers, or gossip-flooded contacts. Runs a FIND_NODE lookup for
   * our own id so peers closest to us land in our k-buckets, then gossips
   * our presence so the cluster learns about this node.
   * @returns {Promise<{discovered: number, routedThrough: number, elapsedMs: number}>}
   */
  async join(seeds = []) {
    const startedAt = Date.now();
    const seedList = [...new Set([...(this.config.bootstrapPeers || []), ...seeds, ...this.peers.keys()])];
    for (const seed of seedList) {
      this.addPeer(seed.id || seed, seed.metadata || {});
    }

    await this.findNode(this.peerId);

    this.broadcastGossip({ type: 'join', nodeId: this.peerId, routed: this.routingTable.size() });
    const summary = {
      discovered: this.routingTable.size(),
      routedThrough: this.peers.size,
      elapsedMs: Date.now() - startedAt,
    };
    this.logger.info('Cluster join complete', summary);
    return summary;
  }

  getNetworkState() {
    return {
      peerId: this.peerId,
      epoch: this.currentEpoch,
      epochSeed: this.vrf.getEpochSeed(this.currentEpoch).slice(0, 16),
      connectedPeers: this.peers.size,
      routingTableSize: this.routingTable.size(),
      activeClaims: this.taskClaims.size,
      claims: Object.fromEntries(this.taskClaims),
    };
  }
}

module.exports = {
  GossipSubNetwork,
  VRFResolver,
  DEFAULT_CONFIG,
  KademliaTable,
  KBucket,
  nodeIdHash,
  xorDistance,
  compareDistance,
  sharedPrefixLength,
  NoiseHandshake,
  NoiseSession,
};

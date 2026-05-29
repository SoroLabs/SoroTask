const crypto = require('crypto');
const http = require('http');
const EventEmitter = require('events');
const { Server: SocketIOServer } = require('socket.io');
const { io: createSocketClient } = require('socket.io-client');
const { createLogger } = require('./logger');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_STALE_PEER_MS = 45000;
const DEFAULT_AUTH_WINDOW_MS = 30000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

function parsePeerList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((peer) => String(peer).trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((peer) => peer.trim())
    .filter(Boolean);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function createSignature({ type, payload, nodeId, timestamp, nonce }, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(stableStringify({ type, payload, nodeId, timestamp, nonce }))
    .digest('hex');
}

function createSignedEnvelope({ type, payload = {}, nodeId, secret, now = Date.now() }) {
  if (!secret) {
    throw new Error('P2P shared secret is required to sign messages');
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const envelope = {
    type,
    payload,
    nodeId,
    timestamp: now,
    nonce,
  };
  return {
    ...envelope,
    signature: createSignature(envelope, secret),
  };
}

function verifySignedEnvelope(envelope, secret, options = {}) {
  const now = options.now || Date.now();
  const authWindowMs = options.authWindowMs || DEFAULT_AUTH_WINDOW_MS;
  const seenNonces = options.seenNonces || null;

  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, reason: 'invalid_envelope' };
  }
  const required = ['type', 'payload', 'nodeId', 'timestamp', 'nonce', 'signature'];
  const missing = required.filter((key) => envelope[key] == null);
  if (missing.length > 0) {
    return { ok: false, reason: 'missing_fields', missing };
  }
  if (Math.abs(now - Number(envelope.timestamp)) > authWindowMs) {
    return { ok: false, reason: 'timestamp_out_of_window' };
  }
  if (seenNonces && seenNonces.has(envelope.nonce)) {
    return { ok: false, reason: 'replay_detected' };
  }

  const expected = createSignature(envelope, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(String(envelope.signature), 'hex');
  if (
    expectedBuffer.length !== actualBuffer.length
    || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  if (seenNonces) {
    seenNonces.add(envelope.nonce);
  }
  return { ok: true };
}

function hashToUnit(value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest();
  const integer = digest.readUInt32BE(0);
  return integer / 0xffffffff;
}

function normalizeLoad(load = {}) {
  const capacity = Math.max(Number(load.capacity) || 1, 1);
  const inFlight = Math.max(Number(load.inFlight) || 0, 0);
  const queueDepth = Math.max(Number(load.queueDepth) || 0, 0);
  const pressure = Math.min((inFlight + queueDepth) / capacity, 10);
  return {
    ...load,
    capacity,
    inFlight,
    queueDepth,
    pressure,
  };
}

function assignTasksByRendezvous(taskIds, selfNode, peers = []) {
  const nodes = [selfNode, ...peers]
    .filter((node) => node && node.nodeId)
    .map((node) => ({
      ...node,
      load: normalizeLoad(node.load),
    }));

  const ownedTaskIds = [];
  const skippedTaskIds = [];
  const owners = {};

  for (const taskId of taskIds || []) {
    let owner = null;
    let bestScore = -1;

    for (const node of nodes) {
      const baseScore = hashToUnit(`${taskId}:${node.nodeId}`);
      const loadPenalty = 1 + node.load.pressure;
      const score = baseScore / loadPenalty;
      if (score > bestScore) {
        bestScore = score;
        owner = node;
      }
    }

    if (!owner || owner.nodeId === selfNode.nodeId) {
      ownedTaskIds.push(taskId);
      owners[taskId] = selfNode.nodeId;
    } else {
      skippedTaskIds.push(taskId);
      owners[taskId] = owner.nodeId;
    }
  }

  return {
    ownedTaskIds,
    skippedTaskIds,
    owners,
    nodes,
  };
}

class KeeperP2PNetwork extends EventEmitter {
  constructor(options = {}) {
    super();

    this.enabled = Boolean(options.enabled);
    this.nodeId = options.nodeId || crypto.randomUUID();
    this.publicUrl = options.publicUrl || null;
    this.listenHost = options.listenHost || '0.0.0.0';
    this.listenPort = Number.isFinite(options.listenPort) ? options.listenPort : 0;
    this.sharedSecret = options.sharedSecret || null;
    this.bootstrapPeers = parsePeerList(options.bootstrapPeers);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.stalePeerMs = options.stalePeerMs || DEFAULT_STALE_PEER_MS;
    this.authWindowMs = options.authWindowMs || DEFAULT_AUTH_WINDOW_MS;
    this.connectTimeoutMs = options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    this.loadProvider = options.loadProvider || (() => ({}));
    this.logger = options.logger || createLogger('p2p');

    this.httpServer = null;
    this.io = null;
    this.started = false;
    this.peers = new Map();
    this.sockets = new Map();
    this.seenNonces = new Set();
    this.heartbeatTimer = null;
    this.pruneTimer = null;
  }

  async start() {
    if (!this.enabled || this.started) {
      return this.getStateSnapshot();
    }
    if (!this.sharedSecret) {
      throw new Error('P2P_SHARED_SECRET is required when P2P networking is enabled');
    }

    this.httpServer = http.createServer();
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*' },
      serveClient: false,
    });
    this.io.on('connection', (socket) => this.registerSocketHandlers(socket, { inbound: true }));

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off('error', onError);
        const address = this.httpServer.address();
        if (!this.publicUrl && address && address.port) {
          this.publicUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      };

      this.httpServer.once('error', onError);
      this.httpServer.once('listening', onListening);
      this.httpServer.listen(this.listenPort, this.listenHost);
    });

    this.started = true;
    this.bootstrapPeers.forEach((peerUrl) => this.connect(peerUrl));
    this.heartbeatTimer = setInterval(() => this.broadcastHeartbeat(), this.heartbeatIntervalMs);
    this.pruneTimer = setInterval(() => this.pruneStalePeers(), Math.min(this.stalePeerMs, 10000));
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
    if (typeof this.pruneTimer.unref === 'function') {
      this.pruneTimer.unref();
    }
    this.logger.info('P2P keeper network started', {
      nodeId: this.nodeId,
      publicUrl: this.publicUrl,
      bootstrapPeers: this.bootstrapPeers.length,
    });
    return this.getStateSnapshot();
  }

  registerSocketHandlers(socket, metadata = {}) {
    socket.data = socket.data || {};
    socket.data.inbound = Boolean(metadata.inbound);

    socket.on('keeper:hello', (envelope) => {
      const verification = this.verify(envelope);
      if (!verification.ok) {
        this.rejectSocket(socket, verification.reason);
        return;
      }

      const peer = this.upsertPeer(envelope.nodeId, {
        url: envelope.payload.url || null,
        load: envelope.payload.load || {},
        state: envelope.payload.state || {},
        direction: metadata.inbound ? 'inbound' : 'outbound',
      });

      socket.data.nodeId = peer.nodeId;
      this.sockets.set(peer.nodeId, socket);
      socket.emit('keeper:hello:ack', this.sign('hello_ack', {
        url: this.publicUrl,
        load: this.getLocalLoad(),
        peers: this.getKnownPeerUrls(),
      }));
      socket.emit('keeper:peers', this.sign('peer_list', {
        peers: this.getKnownPeerUrls(),
      }));
    });

    socket.on('keeper:hello:ack', (envelope) => this.handleEnvelope(socket, envelope));
    socket.on('keeper:heartbeat', (envelope) => this.handleEnvelope(socket, envelope));
    socket.on('keeper:peers', (envelope) => this.handleEnvelope(socket, envelope));
    socket.on('disconnect', () => {
      const nodeId = socket.data?.nodeId;
      if (nodeId && this.peers.has(nodeId)) {
        const peer = this.peers.get(nodeId);
        peer.status = 'disconnected';
        peer.lastDisconnectedAt = new Date().toISOString();
        this.emit('peer:disconnected', peer);
      }
    });
  }

  connect(peerUrl) {
    if (!this.enabled || !this.started || !peerUrl || peerUrl === this.publicUrl) {
      return null;
    }
    const existing = Array.from(this.peers.values()).find((peer) => peer.url === peerUrl);
    if (existing && this.sockets.has(existing.nodeId)) {
      return this.sockets.get(existing.nodeId);
    }

    const socket = createSocketClient(peerUrl, {
      reconnection: true,
      timeout: this.connectTimeoutMs,
      transports: ['websocket', 'polling'],
      autoUnref: true,
    });

    this.registerSocketHandlers(socket, { inbound: false });
    socket.on('connect', () => {
      socket.emit('keeper:hello', this.sign('hello', {
        url: this.publicUrl,
        load: this.getLocalLoad(),
        state: this.getLocalState(),
      }));
    });
    socket.on('connect_error', (error) => {
      this.logger.warn('P2P peer connection failed', {
        peerUrl,
        error: error.message,
      });
      this.emit('peer:error', { peerUrl, error });
    });

    return socket;
  }

  handleEnvelope(socket, envelope) {
    const verification = this.verify(envelope);
    if (!verification.ok) {
      this.rejectSocket(socket, verification.reason);
      return;
    }

    const payload = envelope.payload || {};
    const peer = this.upsertPeer(envelope.nodeId, {
      url: payload.url || null,
      load: payload.load || {},
      state: payload.state || {},
      direction: socket.data?.inbound ? 'inbound' : 'outbound',
    });
    socket.data.nodeId = peer.nodeId;
    this.sockets.set(peer.nodeId, socket);

    if (envelope.type === 'peer_list' || envelope.type === 'hello_ack') {
      parsePeerList(payload.peers)
        .filter((peerUrl) => peerUrl !== this.publicUrl)
        .forEach((peerUrl) => this.connect(peerUrl));
    }
  }

  rejectSocket(socket, reason) {
    this.logger.warn('Rejected P2P message', { reason });
    this.emit('security:rejected', { reason });
    socket.disconnect(true);
  }

  sign(type, payload = {}) {
    return createSignedEnvelope({
      type,
      payload,
      nodeId: this.nodeId,
      secret: this.sharedSecret,
    });
  }

  verify(envelope) {
    return verifySignedEnvelope(envelope, this.sharedSecret, {
      seenNonces: this.seenNonces,
      authWindowMs: this.authWindowMs,
    });
  }

  upsertPeer(nodeId, update = {}) {
    if (!nodeId || nodeId === this.nodeId) {
      return { nodeId: this.nodeId, status: 'self' };
    }

    const existing = this.peers.get(nodeId) || {
      nodeId,
      firstSeenAt: new Date().toISOString(),
      failures: 0,
    };
    const peer = {
      ...existing,
      ...update,
      load: normalizeLoad(update.load || existing.load || {}),
      status: 'healthy',
      lastSeenAt: Date.now(),
      lastSeenIso: new Date().toISOString(),
    };
    this.peers.set(nodeId, peer);
    this.emit('peer:updated', peer);
    return peer;
  }

  getLocalLoad() {
    return normalizeLoad(this.loadProvider() || {});
  }

  getLocalState() {
    const load = this.getLocalLoad();
    return {
      taskCount: Number(load.taskCount) || 0,
      paused: Boolean(load.paused),
      queueDepth: load.queueDepth,
      inFlight: load.inFlight,
    };
  }

  getKnownPeerUrls() {
    const urls = new Set(this.bootstrapPeers);
    if (this.publicUrl) {
      urls.add(this.publicUrl);
    }
    this.peers.forEach((peer) => {
      if (peer.url) {
        urls.add(peer.url);
      }
    });
    return Array.from(urls);
  }

  getHealthyPeers(now = Date.now()) {
    return Array.from(this.peers.values()).filter((peer) => (
      peer.status === 'healthy' && now - peer.lastSeenAt <= this.stalePeerMs
    ));
  }

  isHealthy() {
    return this.enabled && this.started && this.getHealthyPeers().length > 0;
  }

  broadcastHeartbeat() {
    if (!this.started) {
      return;
    }
    const heartbeat = this.sign('heartbeat', {
      url: this.publicUrl,
      load: this.getLocalLoad(),
      state: this.getLocalState(),
    });

    if (this.io) {
      this.io.emit('keeper:heartbeat', heartbeat);
    }
    this.sockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit('keeper:heartbeat', heartbeat);
      }
    });
  }

  pruneStalePeers(now = Date.now()) {
    const stale = [];
    this.peers.forEach((peer, nodeId) => {
      if (now - peer.lastSeenAt > this.stalePeerMs) {
        stale.push(nodeId);
      }
    });

    stale.forEach((nodeId) => {
      const peer = this.peers.get(nodeId);
      const socket = this.sockets.get(nodeId);
      if (socket) {
        socket.disconnect();
      }
      this.sockets.delete(nodeId);
      this.peers.delete(nodeId);
      this.emit('peer:stale', peer);
      this.logger.warn('Pruned stale P2P peer', { nodeId });
    });

    return stale;
  }

  selectOwnedTasks(taskIds) {
    const selection = assignTasksByRendezvous(
      taskIds,
      {
        nodeId: this.nodeId,
        url: this.publicUrl,
        load: this.getLocalLoad(),
      },
      this.getHealthyPeers(),
    );

    return {
      shardIndex: 0,
      shardCount: selection.nodes.length || 1,
      shardLabel: `p2p:${this.nodeId}`,
      ...selection,
    };
  }

  getStateSnapshot() {
    const peers = this.getHealthyPeers();
    return {
      enabled: this.enabled,
      started: this.started,
      nodeId: this.nodeId,
      publicUrl: this.publicUrl,
      healthy: this.isHealthy(),
      peerCount: this.peers.size,
      healthyPeerCount: peers.length,
      peers: peers.map((peer) => ({
        nodeId: peer.nodeId,
        url: peer.url,
        status: peer.status,
        lastSeenAt: peer.lastSeenIso,
        load: peer.load,
      })),
    };
  }

  async stop() {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.pruneTimer);
    this.heartbeatTimer = null;
    this.pruneTimer = null;

    this.sockets.forEach((socket) => socket.disconnect());
    this.sockets.clear();

    if (this.io) {
      await new Promise((resolve) => this.io.close(resolve));
      this.io = null;
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    this.started = false;
    this.logger.info('P2P keeper network stopped', { nodeId: this.nodeId });
  }
}

module.exports = {
  KeeperP2PNetwork,
  assignTasksByRendezvous,
  createSignedEnvelope,
  parsePeerList,
  verifySignedEnvelope,
};

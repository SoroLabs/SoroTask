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
const DEFAULT_TASK_LOCK_TTL_MS = 60000;
const DEFAULT_P2P_TOPICS = {
  discovery: 'sorotask.keeper.discovery.v1',
  taskLocks: 'sorotask.keeper.task-locks.v1',
  bids: 'sorotask.keeper.bids.v1',
};

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

async function createDefaultLibp2pNode(options = {}) {
  try {
    const [
      { createLibp2p },
      { tcp },
      { webSockets },
      { noise },
      { yamux },
      { bootstrap },
      { gossipsub },
    ] = await Promise.all([
      import('libp2p'),
      import('@libp2p/tcp'),
      import('@libp2p/websockets'),
      import('@chainsafe/libp2p-noise'),
      import('@chainsafe/libp2p-yamux'),
      import('@libp2p/bootstrap'),
      import('@chainsafe/libp2p-gossipsub'),
    ]);

    const listenPort = Number.isFinite(options.listenPort) ? options.listenPort : 0;
    const listenHost = options.listenHost || '0.0.0.0';
    const bootstrapPeers = parsePeerList(options.bootstrapPeers);

    return createLibp2p({
      addresses: {
        listen: [`/ip4/${listenHost}/tcp/${listenPort}`],
      },
      transports: [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: bootstrapPeers.length > 0 ? [bootstrap({ list: bootstrapPeers })] : [],
      services: {
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
        }),
      },
    });
  } catch (error) {
    const wrapped = new Error(
      `Unable to initialize libp2p transport. Install libp2p, @libp2p/tcp, @libp2p/websockets, @chainsafe/libp2p-noise, @chainsafe/libp2p-yamux, @libp2p/bootstrap, and @chainsafe/libp2p-gossipsub or provide libp2pNodeFactory. ${error.message}`,
    );
    wrapped.cause = error;
    throw wrapped;
  }
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
    this.transport = options.transport || 'socketio';
    this.taskLockTtlMs = options.taskLockTtlMs || DEFAULT_TASK_LOCK_TTL_MS;
    this.topics = {
      ...DEFAULT_P2P_TOPICS,
      ...(options.topics || {}),
    };
    this.loadProvider = options.loadProvider || (() => ({}));
    this.libp2pNode = options.libp2pNode || null;
    this.libp2pNodeFactory = options.libp2pNodeFactory || (
      (options.transport === 'libp2p' || options.transport === 'hybrid')
        ? createDefaultLibp2pNode
        : null
    );
    this.logger = options.logger || createLogger('p2p');

    this.httpServer = null;
    this.io = null;
    this.libp2pStarted = false;
    this.libp2pMessageListenerRegistered = false;
    this.started = false;
    this.peers = new Map();
    this.sockets = new Map();
    this.taskLocks = new Map();
    this.seenNonces = new Set();
    this.heartbeatTimer = null;
    this.pruneTimer = null;
    // Issue #841: active bid auction state — keyed by taskId
    this.activeBids = new Map();
  }

  async start() {
    if (!this.enabled || this.started) {
      return this.getStateSnapshot();
    }
    if (!this.sharedSecret) {
      throw new Error('P2P_SHARED_SECRET is required when P2P networking is enabled');
    }

    if (this.shouldStartSocketTransport()) {
      await this.startSocketTransport();
    }

    if (this.shouldStartLibp2pTransport()) {
      await this.startLibp2pTransport();
    }

    this.started = true;
    if (this.shouldStartSocketTransport()) {
      this.bootstrapPeers.forEach((peerUrl) => this.connect(peerUrl));
    }
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

  shouldStartSocketTransport() {
    return this.transport === 'socketio' || this.transport === 'hybrid';
  }

  shouldStartLibp2pTransport() {
    return this.transport === 'libp2p'
      || this.transport === 'hybrid'
      || Boolean(this.libp2pNode || this.libp2pNodeFactory);
  }

  async startSocketTransport() {
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
  }

  async startLibp2pTransport() {
    if (!this.libp2pNode && this.libp2pNodeFactory) {
      this.libp2pNode = await this.libp2pNodeFactory({
        nodeId: this.nodeId,
        listenHost: this.listenHost,
        listenPort: this.listenPort,
        bootstrapPeers: this.bootstrapPeers,
        topics: this.topics,
      });
    }

    if (!this.libp2pNode) {
      if (this.transport === 'libp2p') {
        throw new Error('P2P libp2p transport requested but no libp2p node factory was provided');
      }
      return;
    }

    if (typeof this.libp2pNode.start === 'function') {
      await this.libp2pNode.start();
    }

    this.subscribeLibp2pTopic(this.topics.discovery);
    this.subscribeLibp2pTopic(this.topics.taskLocks);
    this.subscribeLibp2pTopic(this.topics.bids);
    this.libp2pStarted = true;
    this.broadcastLibp2pDiscovery();
  }

  subscribeLibp2pTopic(topic) {
    const pubsub = this.libp2pNode && this.libp2pNode.services && this.libp2pNode.services.pubsub;
    if (!pubsub || typeof pubsub.subscribe !== 'function') {
      return;
    }

    pubsub.subscribe(topic);
    if (this.libp2pMessageListenerRegistered) {
      return;
    }

    if (typeof pubsub.addEventListener === 'function') {
      pubsub.addEventListener('message', (event) => this.handleLibp2pMessage(event));
    } else if (typeof pubsub.on === 'function') {
      pubsub.on('message', (message) => this.handleLibp2pMessage(message));
    }
    this.libp2pMessageListenerRegistered = true;
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
    socket.on('keeper:task-lock', (envelope) => this.handleTaskLockEnvelope(envelope));
    // Issue #841: receive incoming fee bids from peer keepers
    socket.on('keeper:bid', (envelope) => {
      const verification = this.verify(envelope);
      if (!verification.ok) {
        this.logger.warn('Rejected invalid bid envelope', { reason: verification.reason });
        return;
      }
      this._recordBid(envelope);
      this.emit('bid:received', { nodeId: envelope.nodeId, payload: envelope.payload });
    });
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

  handleLibp2pMessage(event) {
    const detail = event.detail || event;
    const topic = detail.topic;
    const data = detail.data || detail;
    let envelope;

    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      envelope = JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      this.logger.warn('Rejected malformed libp2p pubsub message', { error: error.message });
      return;
    }

    if (topic === this.topics.taskLocks) {
      this.handleTaskLockEnvelope(envelope);
      return;
    }
    if (topic === this.topics.bids) {
      const verification = this.verify(envelope);
      if (verification.ok) {
        this._recordBid(envelope);
        this.emit('bid:received', { nodeId: envelope.nodeId, payload: envelope.payload });
      }
      return;
    }
    this.handleDiscoveryEnvelope(envelope);
  }

  handleDiscoveryEnvelope(envelope) {
    const verification = this.verify(envelope);
    if (!verification.ok) {
      this.logger.warn('Rejected invalid discovery envelope', { reason: verification.reason });
      this.emit('security:rejected', { reason: verification.reason });
      return;
    }

    const payload = envelope.payload || {};
    this.upsertPeer(envelope.nodeId, {
      url: payload.url || null,
      load: payload.load || {},
      state: payload.state || {},
      direction: 'libp2p',
      peerId: payload.peerId || null,
    });
  }

  handleTaskLockEnvelope(envelope) {
    const verification = this.verify(envelope);
    if (!verification.ok) {
      this.logger.warn('Rejected invalid task lock envelope', { reason: verification.reason });
      this.emit('security:rejected', { reason: verification.reason });
      return;
    }

    const payload = envelope.payload || {};
    if (payload.taskId == null) {
      return;
    }

    const lock = {
      taskId: String(payload.taskId),
      nodeId: envelope.nodeId,
      claimedAt: Number(payload.claimedAt) || envelope.timestamp,
      expiresAt: Number(payload.expiresAt) || Date.now() + this.taskLockTtlMs,
      correlationId: payload.correlationId || null,
    };

    this.taskLocks.set(lock.taskId, lock);
    this.emit('task-lock:claimed', lock);
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

    this.publishEnvelope(this.topics.discovery, 'keeper:heartbeat', heartbeat);
  }

  broadcastLibp2pDiscovery() {
    const envelope = this.sign('peer_discovery', {
      url: this.publicUrl,
      load: this.getLocalLoad(),
      state: this.getLocalState(),
    });
    this.publishLibp2p(this.topics.discovery, envelope);
  }

  publishEnvelope(topic, socketEvent, envelope) {
    this.publishLibp2p(topic, envelope);
    if (this.io) {
      this.io.emit(socketEvent, envelope);
    }
    this.sockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit(socketEvent, envelope);
      }
    });
  }

  publishLibp2p(topic, envelope) {
    const pubsub = this.libp2pNode && this.libp2pNode.services && this.libp2pNode.services.pubsub;
    if (!this.libp2pStarted || !pubsub || typeof pubsub.publish !== 'function') {
      return false;
    }

    const encoded = Buffer.from(JSON.stringify(envelope));
    pubsub.publish(topic, encoded);
    return true;
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
      this.clearTaskLocksForPeer(nodeId);
      this.emit('peer:stale', peer);
      this.logger.warn('Pruned stale P2P peer', { nodeId });
    });

    // Also prune expired bid auction entries (Issue #841)
    this.pruneExpiredBids(now);
    this.pruneExpiredTaskLocks(now);

    return stale;
  }

  selectOwnedTasks(taskIds) {
    this.pruneExpiredTaskLocks();
    const activeLocks = this.getActiveTaskLocks();
    const remoteLockedTaskIds = [];
    const unlockedTaskIds = (taskIds || []).filter((taskId) => {
      const lock = activeLocks[String(taskId)];
      if (lock && lock.nodeId !== this.nodeId) {
        remoteLockedTaskIds.push(taskId);
        return false;
      }
      return true;
    });
    const selection = assignTasksByRendezvous(
      unlockedTaskIds,
      {
        nodeId: this.nodeId,
        url: this.publicUrl,
        load: this.getLocalLoad(),
      },
      this.getHealthyPeers(),
    );
    remoteLockedTaskIds.forEach((taskId) => {
      selection.skippedTaskIds.push(taskId);
      selection.owners[taskId] = activeLocks[String(taskId)].nodeId;
    });

    return {
      shardIndex: 0,
      shardCount: selection.nodes.length || 1,
      shardLabel: `p2p:${this.nodeId}`,
      activeLocks,
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
      libp2pStarted: this.libp2pStarted,
      transport: this.transport,
      taskLockCount: this.taskLocks.size,
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
    if (this.libp2pNode && typeof this.libp2pNode.stop === 'function') {
      await this.libp2pNode.stop();
    }

    this.libp2pStarted = false;
    this.libp2pMessageListenerRegistered = false;
    this.started = false;
    this.logger.info('P2P keeper network stopped', { nodeId: this.nodeId });
  }

  broadcastTaskClaimIntent(taskId) {
    return this.broadcastTaskLock(taskId);
  }

  broadcastTaskLock(taskId, metadata = {}) {
    if (!this.enabled || !this.started) {
      return null;
    }

    const now = Date.now();
    const intent = this.sign('task_lock_claimed', {
      taskId: String(taskId),
      claimedAt: now,
      expiresAt: now + this.taskLockTtlMs,
      correlationId: metadata.correlationId || null,
    });

    this.handleTaskLockEnvelope(intent);
    this.publishEnvelope(this.topics.taskLocks, 'keeper:task-lock', intent);
    return intent;
  }

  getActiveTaskLocks(now = Date.now()) {
    this.pruneExpiredTaskLocks(now);
    const locks = {};
    this.taskLocks.forEach((lock, taskId) => {
      locks[taskId] = { ...lock };
    });
    return locks;
  }

  clearTaskLocksForPeer(nodeId) {
    const released = [];
    this.taskLocks.forEach((lock, taskId) => {
      if (lock.nodeId === nodeId) {
        released.push(taskId);
        this.taskLocks.delete(taskId);
      }
    });
    if (released.length > 0) {
      this.emit('tasks:reassign', { nodeId, taskIds: released });
    }
    return released;
  }

  pruneExpiredTaskLocks(now = Date.now()) {
    const expired = [];
    this.taskLocks.forEach((lock, taskId) => {
      if (lock.expiresAt <= now) {
        expired.push(taskId);
        this.taskLocks.delete(taskId);
      }
    });
    if (expired.length > 0) {
      this.emit('tasks:reassign', { nodeId: null, taskIds: expired });
    }
    return expired;
  }

  resolveExecutionConflicts(taskId, peersClaims) {
    // Resolve execution conflicts off-chain among keeper peer nodes.
    const sortedClaims = peersClaims.sort((a, b) => a.timestamp - b.timestamp);
    return sortedClaims[0]?.nodeId === this.nodeId;
  }

  // ---------------------------------------------------------------------------
  // Decentralized Task Bidding Auction Engine (Issue #841)
  //
  // Keepers compete off-chain for task execution rights using a signed fee-bid
  // protocol broadcast over the P2P pubsub channel. The keeper with the lowest
  // fee bid wins exclusive execution rights for a 5-ledger window (~25 seconds
  // on Stellar). This eliminates redundant on-chain gas wars when multiple
  // keepers are all racing to execute the same due task.
  //
  // Protocol flow:
  //   1. Each keeper calls broadcastBid(taskId, feeLumens) to announce its fee.
  //   2. All peers receive bid envelopes via 'keeper:bid' socket events and
  //      store them in this.activeBids (keyed by taskId).
  //   3. After BID_COLLECTION_WINDOW_MS the auction resolves: the keeper with
  //      the lowest fee wins. Ties are broken deterministically by nodeId.
  //   4. Only the winner proceeds to call execute() on-chain; all other keepers
  //      skip this task for the current cycle, eliminating redundant gas spend.
  // ---------------------------------------------------------------------------

  /**
   * Broadcast a signed fee bid for a specific task over the P2P network.
   *
   * @param {string|number} taskId - The task being bid on.
   * @param {number} feeLumens - Proposed transaction fee in stroops (1 XLM = 10^7 stroops).
   * @param {number} [now] - Override for current timestamp (testing).
   */
  broadcastBid(taskId, feeLumens, now = Date.now()) {
    if (!this.enabled || !this.started) {
      return;
    }

    const bid = this.sign('task_bid', {
      taskId: String(taskId),
      feeLumens: Number(feeLumens),
      // Ledger window: bid is valid for 5 Stellar ledgers (~25 seconds).
      expiresAt: now + KeeperBidAuction.BID_WINDOW_MS,
    });

    // Record our own bid locally before broadcasting.
    this._recordBid(bid);

    if (this.io) {
      this.publishEnvelope(this.topics.bids, 'keeper:bid', bid);
    } else {
      this.publishLibp2p(this.topics.bids, bid);
    }

    this.logger.debug('Bid broadcast', {
      taskId,
      feeLumens,
      nodeId: this.nodeId,
    });
  }

  /**
   * @private
   * Record an incoming or local bid in this.activeBids.
   * Bids are grouped by taskId and stored per nodeId (last-write wins per node).
   */
  _recordBid(envelope) {
    if (!envelope || !envelope.payload) return;
    const { taskId, feeLumens, expiresAt } = envelope.payload;
    if (taskId == null || feeLumens == null) return;

    const key = String(taskId);
    if (!this.activeBids.has(key)) {
      this.activeBids.set(key, new Map());
    }
    this.activeBids.get(key).set(envelope.nodeId, {
      nodeId: envelope.nodeId,
      feeLumens: Number(feeLumens),
      expiresAt: Number(expiresAt) || 0,
      receivedAt: Date.now(),
    });
  }

  /**
   * Resolve the auction winner for a task and determine whether this node
   * has won the right to execute it.
   *
   * Call this after broadcastBid() + BID_COLLECTION_WINDOW_MS to let all
   * peers' bids arrive before resolving. Returns true if this node won.
   *
   * @param {string|number} taskId
   * @param {number} [now] - Override for timestamp (testing).
   * @returns {{ won: boolean, winner: string|null, winningFee: number|null, bidCount: number }}
   */
  resolveAuction(taskId, now = Date.now()) {
    const key = String(taskId);
    const bids = this.activeBids.get(key);

    if (!bids || bids.size === 0) {
      // No peers bid — we win by default.
      return { won: true, winner: this.nodeId, winningFee: null, bidCount: 0 };
    }

    // Filter out expired bids.
    const valid = Array.from(bids.values()).filter((bid) => bid.expiresAt > now);

    if (valid.length === 0) {
      return { won: true, winner: this.nodeId, winningFee: null, bidCount: 0 };
    }

    // Sort ascending by fee, break ties deterministically by nodeId (lexicographic).
    valid.sort((a, b) => {
      if (a.feeLumens !== b.feeLumens) return a.feeLumens - b.feeLumens;
      return a.nodeId < b.nodeId ? -1 : 1;
    });

    const winner = valid[0];
    const won = winner.nodeId === this.nodeId;

    if (!won) {
      this.logger.debug('Auction lost — deferring execution to winner', {
        taskId,
        winner: winner.nodeId,
        winningFee: winner.feeLumens,
        ourNodeId: this.nodeId,
      });
    }

    return {
      won,
      winner: winner.nodeId,
      winningFee: winner.feeLumens,
      bidCount: valid.length,
    };
  }

  /**
   * Clean up expired bid records to prevent unbounded memory growth.
   * Called automatically by the internal prune timer.
   */
  pruneExpiredBids(now = Date.now()) {
    for (const [taskId, bids] of this.activeBids) {
      for (const [nodeId, bid] of bids) {
        if (bid.expiresAt <= now) {
          bids.delete(nodeId);
        }
      }
      if (bids.size === 0) {
        this.activeBids.delete(taskId);
      }
    }
  }
}

/**
 * Auction constants shared between KeeperP2PNetwork methods and external callers.
 */
const KeeperBidAuction = {
  /** 5 Stellar ledgers ≈ 25 seconds. Bid validity window. */
  BID_WINDOW_MS: 25000,
  /** Collection window before resolving auction winner. */
  BID_COLLECTION_WINDOW_MS: 5000,
};

module.exports = {
  KeeperP2PNetwork,
  KeeperBidAuction,
  assignTasksByRendezvous,
  createDefaultLibp2pNode,
  createSignedEnvelope,
  parsePeerList,
  verifySignedEnvelope,
};

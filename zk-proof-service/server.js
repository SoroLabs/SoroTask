const express = require('express');
const path = require('path');
const { middleware } = require('express-openapi-validator');
const { ZKProofService } = require('./index');

const { createMetrics } = require('./lib/metrics');
const { Halo2ProverAdapter } = require('./lib/halo2-adapter');
const { selectProverBackend, withProofTiming } = require('./lib/prover-backend');
const {
  CircuitRegistry,
  createCircuitRoutes,
  sha256Hex,
} = require('./lib/circuit-registry');
const { CircuitIntegrityVerifier } = require('./lib/circuit-integrity');
const {
  hashTaskCondition,
  serializeProof,
  checkConstraint,
  decryptWitnessECIES,
  zeroizeBuffer,
} = require('./lib/helpers');
const {
  withEphemeralDir,
  writeFile,
  startScrubber,
} = require('./lib/ephemeralDir');
const { CPU_CONCURRENCY } = require('./lib/prover-job-queue');

const SERVICE_VERSION = '1.0.0';
const problem = (res, status, title, detail, errors) => res.status(status).type('application/problem+json').json({
  type: `https://sorotask.com/problems/${status}`,
  title,
  status,
  detail,
  ...(errors ? { errors } : {}),
});

function createApp(zkService, options = {}) {
  const app = express();
  const apiToken = options.apiToken ?? process.env.ZK_PROOF_API_TOKEN;
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(middleware({
    apiSpec: options.apiSpec || path.join(__dirname, 'openapi.yaml'),
    validateRequests: true,
    validateResponses: false,
    unknownFormats: ['int64'],
  }));

  app.use((req, res, next) => {
    if (!apiToken || req.path === '/health') return next();
    const header = req.headers.authorization || '';
    if (header !== `Bearer ${apiToken}`) return problem(res, 401, 'Unauthorized', 'A valid bearer token is required.');
    next();
  });

  app.get('/health', (_req, res) => {
    const workerPool = syncPoolGauges();
    let status = 'unavailable';
    if (zkService.isReady && workerPool.totalWorkers > 0) {
      status = workerPool.activeWorkers === workerPool.totalWorkers ? 'degraded' : 'healthy';
    }
    // Issue #860: report 503 when queue depth exceeds the safety threshold.
    const queueOverloaded = inFlight > queueDepthThreshold;
    if (queueOverloaded && status !== 'unavailable') {
      status = 'overloaded';
    }
    const httpStatus = status === 'unavailable' || status === 'overloaded' ? 503 : 200;
    res.status(httpStatus).json({
      status,
      version,
      workerPool,
      queueDepth: inFlight,
      queueDepthThreshold,
      // Issue #858: WASM sandbox pool status
      wasmSandboxPool: {
        poolSize: wasmSandboxPool.poolSize,
        activeCount: wasmSandboxPool._activeCount,
        queueDepth: wasmSandboxPool._queue.length,
        timeoutMs: wasmSandboxPool.timeoutMs,
        memoryMb: wasmSandboxPool.memoryMb,
      },
      proverWorkerLimits: {
        timeoutMs: zkService.workerTimeoutMs,
        memoryMb: zkService.workerMemoryMb,
        isolated: true,
      },
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // Issue #860: Prometheus scrape endpoint.
  app.get('/metrics', async (_req, res) => {
    syncPoolGauges();
    res.set('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
    const workerPool = zkService.getWorkerPoolStatus();
    const ready = zkService.isReady && workerPool.totalWorkers > 0;
    res.status(ready ? 200 : 503).json({ status: ready ? 'healthy' : 'unavailable', version: SERVICE_VERSION, workerPool, uptimeSeconds: 0 });
  });
  app.post('/generate-proof', async (req, res, next) => {
    try {
      // Use ephemeral directory for WASM execution to isolate artifacts
      const outputs = await withEphemeralDir(async (ephemeralDir) => {
        await writeFile(ephemeralDir, 'witness.json', JSON.stringify(inputs || {}));
        await writeFile(ephemeralDir, 'taskCondition.json', JSON.stringify(taskCondition));
        return wasmSandboxPool.runInSandbox(wasmBytes, inputs ?? {});
      });
      const conditionHash = hashTaskCondition(taskCondition);
      return res.json({
        status: 'success',
        taskId,
        circuitId,
        conditionHash,
        outputs,
        sandbox: {
          memoryLimitMb: wasmSandboxPool.memoryMb,
          timeoutMs: wasmSandboxPool.timeoutMs,
          isolated: true,
        },
        executionTimeMs: Date.now() - startedAt,
      });
    } catch (err) {
      if (err.message && err.message.includes('timeout')) {
        return sendError(res, 503, 'WASM_SANDBOX_TIMEOUT', err.message);
      }
      return sendError(res, 500, 'WASM_SANDBOX_ERROR', err.message);
    }
  });

  app.get('/proofs/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = await zkService.getAsyncJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    return res.json(job);
  });

  app.get('/proofs/:jobId/stream', async (req, res) => {
    const { jobId } = req.params;
    const job = await zkService.getAsyncJob(jobId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!job) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found', jobId })}\n\n`);
      return res.end();
    }

    res.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
    return res.end();
  });

  app.post('/generate-proof', generateProofLimiter, authenticate, async (req, res) => {
    const { taskId, circuitId, circuitVersion, taskCondition, clientData, encryptedWitness, privateKeyPem } = req.body || {};

    if (taskId == null || typeof taskId === 'string' && isNaN(Number(taskId)) || !circuitId || !taskCondition) {
      return res.status(400).json({ error: 'Invalid task parameters' });
    }

    if (!zkService.isReady) {
      return res.status(503).json({ error: 'ZK proof worker pool is not initialized' });
    }

    let witnessData = clientData || { witness: {} };
    if (encryptedWitness) {
      const keyPem = privateKeyPem || eciesPrivateKey;
      if (!keyPem || typeof encryptedWitness.iv === 'string' && encryptedWitness.iv === 'invalid') {
        return res.status(400).json({ error: 'Invalid ECIES encrypted payload or decryption failure' });
      }
      try {
        const decrypted = decryptWitnessECIES(encryptedWitness, keyPem);
        witnessData = { ...witnessData, witness: decrypted.witness };
      } catch (err) {
        return res.status(400).json({ error: 'Invalid ECIES encrypted payload or decryption failure' });
      }
    }

    try {
      const asyncJob = zkService.enqueueAsyncJob(taskCondition, witnessData, circuitId, getCircuitArtifactHash(circuitId, circuitVersion));
      return res.status(202).json({
        jobId: asyncJob.jobId,
        status: 'queued',
        taskId: Number(taskId),
        pollUrl: `/proofs/${asyncJob.jobId}`,
        createdAt: asyncJob.createdAt,
      });
    } catch (error) {
      return sendError(res, 500, 'PROOF_ENQUEUE_FAILED', error.message);
    }
  });

  app.post('/generate-proof/sync', generateProofLimiter, authenticate, async (req, res) => {
    const startedAt = Date.now();

    let { taskId, circuitId, taskCondition, clientData } = req.body;
    let witnessBuffer = null;

    // Handle ECIES Encrypted Witness Transport if encryptedWitness is provided
    if (clientData.encryptedWitness) {
      if (!eciesPrivateKey) {
        return sendError(res, 400, 'INVALID_INPUT', 'ECIES private key not configured on server');
      }
      try {
        const decrypted = decryptWitnessECIES(clientData.encryptedWitness, eciesPrivateKey);
        clientData = { ...clientData, witness: decrypted.witness };
        witnessBuffer = decrypted.decryptedBuffer;
      } catch (err) {
        return sendError(res, 400, 'INVALID_INPUT', `ECIES witness decryption failed: ${err.message}`);
      }
    }

    // queue-wait proxy: time from request receipt until the worker begins work.
    metrics.queueWaitMs.observe(Date.now() - startedAt);

    inFlight += 1;
    try {
      return await withEphemeralDir(async (ephemeralDir) => {
        // Write witness data to ephemeral directory for isolated prover access
        await writeFile(ephemeralDir, 'witness.json', JSON.stringify(clientData));
        await writeFile(ephemeralDir, 'taskCondition.json', JSON.stringify(taskCondition));

        const genStart = Date.now();
        const rawProof = await zkService.generateProof(taskCondition, clientData);
        metrics.proofDurationMs.observe(Date.now() - genStart);
        syncPoolGauges();
        const constraint = checkConstraint(taskCondition, clientData, circuitId);
        if (!constraint.ok) {
          return sendError(
            res,
            422,
            'CONSTRAINT_UNSATISFIED',
            'Client witness does not satisfy task condition constraints',
            constraint.details,
          );
        }
      const constraint = checkConstraint(taskCondition, clientData, circuitId);
      if (!constraint.ok) {
        return sendError(
          res,
          422,
          'CONSTRAINT_UNSATISFIED',
          'Client witness does not satisfy task condition constraints',
          constraint.details,
        );
      }

      // Wrap the real (CPU) proof generation in the timing harness so there is
      // an apples-to-apples wall-clock baseline for a future GPU backend (#850).
      const timed = await withProofTiming(
        () => zkService.generateProof(taskCondition, clientData, circuitId, getCircuitArtifactHash(circuitId, req.body?.circuitVersion)),
        { backend: proverBackend.backend, label: 'groth16-generate-proof' },
      );
      const rawProof = timed.result;
      metrics.proofDurationMs.observe(Date.now() - genStart);
      syncPoolGauges();
      const conditionHash = hashTaskCondition(taskCondition);
      const proof = {
        pi_a: rawProof.pi_a,
        pi_b: rawProof.pi_b,
        pi_c: rawProof.pi_c,
        publicSignals: rawProof.publicSignals,
      };

        // Wrap the real (CPU) proof generation in the timing harness so there is
        // an apples-to-apples wall-clock baseline for a future GPU backend (#850).
        const timed = await withProofTiming(
          () => zkService.generateProof(taskCondition, clientData),
          { backend: proverBackend.backend, label: 'groth16-generate-proof' },
        );
        const proofResult = timed.result;
        const conditionHash = hashTaskCondition(taskCondition);
        const proof = {
          pi_a: proofResult.pi_a,
          pi_b: proofResult.pi_b,
          pi_c: proofResult.pi_c,
          publicSignals: proofResult.publicSignals,
        };

        return res.json({
          proofId: proofResult.proofId,
          status: 'success',
          taskId,
          conditionHash,
          proof,
          serializedProof: serializeProof(proof),
          proverBackend: proverBackend.backend,
          accelerated: proverBackend.accelerated,
          generationTimeMs: timed.durationMs,
          generatedAt: new Date().toISOString(),
          processingTimeMs: Date.now() - startedAt,
        });
      });
    } catch (error) {
      if (error.code === 'PROVER_MEMORY_LIMIT') {
        return sendError(res, 422, 'PROVER_MEMORY_LIMIT', error.message);
      }
      if (error.code === 'PROVER_TIMEOUT') {
        return sendError(res, 504, 'PROVER_TIMEOUT', error.message);
      }
      if (error.message === 'Worker pool at capacity') {
        return sendError(res, 503, 'SERVICE_NOT_READY', error.message);
      }
      if (error.message === 'Invalid input data') {
        return sendError(res, 400, 'INVALID_INPUT', error.message);
      }
      return sendError(res, 500, 'PROOF_GENERATION_FAILED', error.message);
    } finally {
      inFlight -= 1;
      syncPoolGauges();
      // Zero out decrypted witness buffer immediately after proof generation
      if (witnessBuffer) {
        zeroizeBuffer(witnessBuffer);
      }
    }
  });

  app.post('/verify-proof', authenticate, async (req, res) => {
    const validation = validateVerifyRequest(req.body || {});
    if (!validation.valid) {
      if (validation.missingFields) {
        return sendError(res, 400, 'INVALID_INPUT', 'Invalid verify-proof request', {
          missingFields: validation.missingFields,
        });
      }
      return sendError(res, 400, 'INVALID_INPUT', validation.message);
    }

    if (!zkService.isReady) {
      return sendError(res, 503, 'SERVICE_NOT_READY', 'ZK proof worker pool is not initialized');
    }

    const { taskId, circuitId, taskCondition, conditionHash, proof } = req.body;

    try {
      const result = await zkService.verifyProof({
        taskCondition,
        proof,
        conditionHash,
        circuitId,
      });

      return res.json({
        valid: result.valid,
        proofId: result.proofId,
        taskId,
        conditionHash: result.conditionHash,
        verifiedAt: new Date().toISOString(),
        verificationDetails: result.verificationDetails,
      });
    } catch (error) {
      if (error.message === 'Invalid input data') {
        return sendError(res, 400, 'INVALID_INPUT', error.message);
      }
      return sendError(res, 500, 'PROOF_VERIFICATION_FAILED', error.message);
    }
  });

  // OpenAPI Validation Error Handler
  app.use((err, _req, res, next) => {
    if (err.status || err.errors) {
      return sendError(
        res,
        err.status || 400,
        'INVALID_INPUT',
        err.message || 'Validation error',
        err.errors || [],
      );
    }
    next(err);
  });

  app.post('/proofs/async', authenticate, async (req, res) => {
    const validation = validateGenerateRequest(req.body || {});
    if (!validation.valid) {
      if (validation.missingFields) {
        return sendError(res, 400, 'INVALID_INPUT', 'taskCondition and clientData are required', {
          missingFields: validation.missingFields,
        });
      }
      return sendError(res, 400, 'INVALID_INPUT', validation.message);
    }

    if (!zkService.isReady) {
      return sendError(res, 503, 'SERVICE_NOT_READY', 'ZK proof worker pool is not initialized');
    }

    const { taskId, circuitId, circuitVersion, taskCondition, clientData } = req.body;
    const constraint = checkConstraint(taskCondition, clientData, circuitId);
    if (!constraint.ok) {
      return sendError(
        res,
        422,
        'CONSTRAINT_UNSATISFIED',
        'Client witness does not satisfy task condition constraints',
        constraint.details,
      );
    }

    try {
      // Use ephemeral directory for async proof generation to isolate artifacts
      const asyncJob = zkService.enqueueAsyncJob(taskCondition, clientData, {
        ephemeralDir: true,
      });
      const asyncJob = zkService.enqueueAsyncJob(taskCondition, clientData, circuitId, getCircuitArtifactHash(circuitId, circuitVersion));
      return res.status(202).json({
        jobId: asyncJob.jobId,
        status: asyncJob.status,
        taskId,
        createdAt: asyncJob.createdAt,
      });
    } catch (error) {
      return sendError(res, 500, 'PROOF_ASYNC_ENQUEUE_FAILED', error.message);
    }
  });

  app.get('/proofs/:job_id/stream', (req, res) => {
    const { job_id: jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const job = zkService.getAsyncJob(jobId);
    if (!job) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found', jobId })}\n\n`);
      return res.end();
    }

    res.write(`event: status\ndata: ${JSON.stringify({ jobId: job.jobId, status: job.status, progress: job.progress })}\n\n`);

    if (job.status === 'completed') {
      res.write(`event: complete\ndata: ${JSON.stringify(job.result)}\n\n`);
      return res.end();
    }

    if (job.status === 'failed') {
      res.write(`event: error\ndata: ${JSON.stringify({ jobId: job.jobId, error: job.error })}\n\n`);
      return res.end();
    }

    const onProgress = (data) => {
      if (data.jobId === jobId) {
        res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onComplete = (completedJob) => {
      if (completedJob.jobId === jobId) {
        res.write(`event: complete\ndata: ${JSON.stringify(completedJob.result)}\n\n`);
        cleanup();
        res.end();
      }
    };

    const onError = (failedJob) => {
      if (failedJob.jobId === jobId) {
        res.write(`event: error\ndata: ${JSON.stringify({ jobId, error: failedJob.error })}\n\n`);
        cleanup();
        res.end();
      }
    };

    const cleanup = () => {
      zkService.removeListener('jobProgress', onProgress);
      zkService.removeListener('jobComplete', onComplete);
      zkService.removeListener('jobError', onError);
    };

    zkService.on('jobProgress', onProgress);
    zkService.on('jobComplete', onComplete);
    zkService.on('jobError', onError);

    req.on('close', () => {
      cleanup();
    });
  });

  // -------------------------------------------------------------------------
  // Issue #857 — Circuit Artifact Registry routes
  //
  // Mounts GET /circuits, /circuits/:id, /circuits/:id/:version, and
  // /circuits/:id/:version/artifact?type=wasm|zkey|verifier endpoints.
  // The registry instance is injectable for testing (options.circuitRegistry).
  // -------------------------------------------------------------------------
  const circuitRegistry = options.circuitRegistry ?? new CircuitRegistry();
  function getCircuitArtifactHash(circuitId, circuitVersion) {
    if (!circuitVersion) return '';
    const manifest = circuitRegistry.getManifest(circuitId, circuitVersion);
    return manifest ? sha256Hex(Buffer.from(JSON.stringify(manifest))) : '';
  }
  app.use(createCircuitRoutes(circuitRegistry));

  // -------------------------------------------------------------------------
  // Issue #853 — ZK Identity Attestation Gate (Sybil-Resistant Task Invocation)
  //
  // Integrates Semaphore-style Merkle membership proofs for anonymous,
  // authorized task execution. Task creators can restrict execution to verified
  // community members (identified by membership in a Merkle group) without
  // revealing the member's public key or real-world identity.
  //
  // This implements the on-chain verifiable membership check off-chain, using a
  // Sparse Merkle Tree (SMT) constructed from a trusted set of member identity
  // commitments (hashed public keys). The member proves inclusion by submitting:
  //   - identityCommitment  : SHA-256(publicKey) — acts as the anonymous leaf
  //   - merkleProof         : Array of sibling hashes from leaf → root
  //   - merkleRoot          : The group root stored at registration time
  //
  // The gate verifies inclusion WITHOUT seeing the actual public key, maintaining
  // 100% anonymity. The gate also enforces a per-nullifier spend limit (default
  // 1 use) to prevent Sybil replay attacks: each (circuitId, nullifier) pair may
  // only invoke a task once per epoch.
  //
  // Endpoints:
  //   POST /identity/group         — Register a new member group with a Merkle root
  //   POST /identity/verify-member — Verify membership proof for task access
  //   GET  /identity/groups        — List registered group roots
  // -------------------------------------------------------------------------

  /**
   * In-memory group store: groupId → { merkleRoot, createdAt, memberCount? }
   * In production this would be persisted to a DB and the merkle root written
   * to the on-chain verifier contract.
   * @type {Map<string, object>}
   */
  const identityGroups = options.identityGroups ?? new Map();

  /**
   * Nullifier set to prevent Sybil replay: tracks used (groupId, nullifier)
   * pairs so each anonymous member can only execute a given circuit once per
   * epoch. The nullifier is nullifier = SHA-256(identitySecret || circuitId).
   * @type {Set<string>}
   */
  const usedNullifiers = options.usedNullifiers ?? new Set();

  /**
   * Verify a Merkle inclusion proof.
   * Uses a binary hash tree: parent = SHA-256(min(left, right) || max(left, right))
   * (order-independent, matching most Semaphore/Poseidon-style implementations).
   *
   * @param {string}   leafHash    - SHA-256 hex of the identity commitment
   * @param {string[]} siblings    - Sibling hashes from leaf to root
   * @param {number[]} pathIndices - 0 = left, 1 = right for each level
   * @param {string}   expectedRoot
   * @returns {boolean}
   */
  function verifyMerkleProof(leafHash, siblings, pathIndices, expectedRoot) {
    if (siblings.length !== pathIndices.length) return false;
    let current = leafHash;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      // Order-independent hash: always hash (smaller, larger) to match client
      const left = current <= sibling ? current : sibling;
      const right = current <= sibling ? sibling : current;
      current = sha256Hex(Buffer.from(left + right, 'hex'));
    }
    return current === expectedRoot;
  }

  /**
   * POST /identity/group
   *
   * Register a new membership group identified by a Merkle root.
   * The group creator supplies the root computed over their member set
   * (e.g. SHA-256 of each member's public key, arranged in a balanced binary
   * hash tree). The root acts as the on-chain commitment to the member set.
   *
   * Body: { groupId: string, merkleRoot: string, memberCount?: number }
   * Response 201: { groupId, merkleRoot, createdAt }
   */
  app.post('/identity/group', authenticate, (req, res) => {
    const { groupId, merkleRoot, memberCount } = req.body || {};

    if (!groupId || typeof groupId !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'groupId must be a non-empty string');
    }
    if (!merkleRoot || typeof merkleRoot !== 'string' || !/^[0-9a-fA-F]{64}$/.test(merkleRoot)) {
      return sendError(res, 400, 'INVALID_INPUT', 'merkleRoot must be a 64-character hex string (SHA-256)');
    }
    if (identityGroups.has(groupId)) {
      return sendError(res, 409, 'GROUP_ALREADY_EXISTS', `Group already registered: ${groupId}`);
    }

    const record = {
      groupId,
      merkleRoot: merkleRoot.toLowerCase(),
      memberCount: typeof memberCount === 'number' ? memberCount : null,
      createdAt: new Date().toISOString(),
    };
    identityGroups.set(groupId, record);

    return res.status(201).json(record);
  });

  /**
   * GET /identity/groups
   *
   * List all registered identity group IDs and their Merkle roots.
   * Response 200: { groups: [{ groupId, merkleRoot, memberCount, createdAt }] }
   */
  app.get('/identity/groups', authenticate, (_req, res) => {
    res.json({ groups: Array.from(identityGroups.values()) });
      const proof = await zkService.generateProof(req.body.taskCondition, req.body.clientData);
      res.json({ proofId: proof.proofId, status: 'success', taskId: req.body.taskId, conditionHash: JSON.stringify(req.body.taskCondition), proof, serializedProof: JSON.stringify(proof), generatedAt: new Date().toISOString(), processingTimeMs: 0 });
    } catch (error) { next(error); }
  });
  app.post('/verify-proof', async (req, res, next) => {
    try {
      const result = await zkService.verifyProof(req.body);
      res.json({ ...result, taskId: req.body.taskId, verifiedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error.status || (error.message === 'Worker pool at capacity' ? 503 : 500);
    problem(res, status, status === 503 ? 'Service Unavailable' : 'Request Failed', error.message || 'Unexpected service error', error.errors);
  });
  return app;
}

async function createServer(options = {}) {
  const workerCount = options.workerCount ?? (Number(process.env.ZK_PROOF_WORKERS) || 4);
function createServer(options = {}) {
  const workerCount = options.workerCount ?? (Number(process.env.ZK_PROOF_WORKERS) || CPU_CONCURRENCY);
  const zkService = options.zkService ?? new ZKProofService(workerCount);
  if (!options.skipInitialize) {
    zkService.initialize();
  }

  // Issue #1077: Boot-time circuit integrity attestation
  // Verify all circuit artifact checksums before accepting any proof requests.
  if (!options.skipAttestation) {
    const integrityVerifier = options.integrityVerifier ?? new CircuitIntegrityVerifier({
      circuitsDir: options.circuitsDir || path.join(__dirname, 'circuits'),
      signingSecret: options.signingSecret || process.env.CIRCUIT_MANIFEST_SECRET || '',
    });
    const attestation = await integrityVerifier.attestOnBoot();
    if (!attestation.ok) {
      throw new Error('Circuit integrity attestation failed. Service cannot start.');
    }
  }

  const app = createApp(zkService, options);
  return { app, zkService };
  const zkService = options.zkService || new ZKProofService(options.workerCount || 4);
  if (!options.skipInitialize) zkService.initialize();
  return { app: createApp(zkService, options), zkService };
}

if (require.main === module) {
  createServer().then(({ app }) => {
    app.listen(PORT, () => {
      console.log(`ZK Proof Service listening on port ${PORT}`);
    });
  }).catch((err) => {
    console.error(`[FATAL] Server startup failed: ${err.message}`);
    process.exit(1);
  const { app } = createServer();
  app.listen(PORT, () => {
    console.log(`ZK Proof Service listening on port ${PORT}`);
    // Issue #1076: Start background scrubber to remove orphaned ephemeral dirs
    startScrubber();
  });
  app.listen(Number(process.env.PORT) || 3100, () => console.log('ZK Proof Service listening'));
}

module.exports = { createApp, createServer };

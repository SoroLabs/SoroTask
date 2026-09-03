const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { hashTaskCondition, isValidZkProof, zeroizeBuffer } = require('./lib/helpers');
const { withEphemeralDir, writeFile } = require('./lib/ephemeralDir');
const { ProverJobQueue, CPU_CONCURRENCY } = require('./lib/prover-job-queue');
const { ProofCache, createProofCacheKey } = require('./lib/proof-cache');
const EventEmitter = require('events');

// ---------------------------------------------------------------------------
// zkey Checksum Auditor
// Verifies SHA-256 checksums of Powers of Tau / zkey setup files before the
// service accepts any proof requests.  Aborts startup if a file is missing or
// its digest does not match the published ceremony record.
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 digest of a file at `filePath`.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded digest.
 */
async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verify a set of zkey / Powers-of-Tau setup files against known SHA-256
 * checksums from the official ceremony records.  Throws if any file fails.
 *
 * @param {Array<{ file: string, expectedSha256: string }>} entries
 *   Each entry maps an absolute file path to its expected hex digest.
 * @throws {Error} When a file is missing or its checksum does not match.
 */
async function auditZkeyChecksums(entries) {
  for (const { file, expectedSha256 } of entries) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `[zkey-auditor] Setup file not found: ${file}. ` +
        'Aborting service startup to prevent unsound proof generation.',
      );
    }
    const actual = await computeFileSha256(file);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(
        `[zkey-auditor] Checksum mismatch for ${path.basename(file)}. ` +
        `Expected ${expectedSha256} but got ${actual}. ` +
        'Aborting service startup — file may be corrupted or compromised.',
      );
    }
    console.log(`[zkey-auditor] ✓ ${path.basename(file)} integrity verified (SHA-256 OK)`);
  }
}

// ---------------------------------------------------------------------------
// 2-of-3 MPC Threshold Protocol (Shamir Secret Sharing)
// Splits a decryption key across 3 independent server nodes.  Any 2 shares
// are sufficient to reconstruct the secret; no single node holds the full key.
// ---------------------------------------------------------------------------

/** Prime modulus for GF(p) arithmetic (256-bit safe prime). */
const SHAMIR_PRIME = BigInt(
  '115792089237316195423570985008687907853269984665640564039457584007913129639747',
);

/**
 * Modular inverse via Fermat's little theorem (p must be prime).
 * @param {bigint} a
 * @param {bigint} p
 * @returns {bigint}
 */
function modInverse(a, p) {
  // a^(p-2) mod p
  let result = 1n;
  let base = ((a % p) + p) % p;
  let exp = p - 2n;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % p;
    exp >>= 1n;
    base = (base * base) % p;
  }
  return result;
}

/**
 * Lagrange interpolation to evaluate the polynomial at x=0 (recover secret).
 * @param {Array<[bigint, bigint]>} shares - Array of [x, y] coordinate pairs.
 * @param {bigint} prime
 * @returns {bigint}
 */
function lagrangeInterpolateAtZero(shares, prime) {
  let secret = 0n;
  const k = shares.length;
  for (let i = 0; i < k; i++) {
    const [xi, yi] = shares[i];
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const [xj] = shares[j];
      num = (num * (0n - xj + prime)) % prime;
      den = (den * ((xi - xj + prime) % prime)) % prime;
    }
    const term = (yi * num % prime * modInverse(den, prime)) % prime;
    secret = (secret + term) % prime;
  }
  return secret;
}

/**
 * Split `secret` into `n` shares with threshold `t` using Shamir Secret
 * Sharing over GF(SHAMIR_PRIME).  Generates random polynomial coefficients
 * using Node's crypto.randomBytes for cryptographic security.
 *
 * @param {bigint} secret - The secret value to split (must be < SHAMIR_PRIME).
 * @param {number} t - Minimum number of shares required to reconstruct.
 * @param {number} n - Total number of shares to generate.
 * @returns {Array<{ shareIndex: number, x: bigint, y: bigint }>}
 */
function shamirSplit(secret, t, n) {
  if (secret >= SHAMIR_PRIME) throw new Error('Secret must be smaller than the prime modulus');
  // Build a random degree-(t-1) polynomial: f(x) = secret + a1*x + ... + a(t-1)*x^(t-1)
  const coefficients = [secret];
  for (let i = 1; i < t; i++) {
    const rand = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % SHAMIR_PRIME;
    coefficients.push(rand);
  }
  const shares = [];
  for (let x = 1; x <= n; x++) {
    let y = 0n;
    const xBig = BigInt(x);
    for (let exp = 0; exp < coefficients.length; exp++) {
      let term = coefficients[exp];
      for (let e = 0; e < exp; e++) term = (term * xBig) % SHAMIR_PRIME;
      y = (y + term) % SHAMIR_PRIME;
    }
    shares.push({ shareIndex: x, x: xBig, y });
  }
  return shares;
}

/**
 * Reconstruct a secret from an array of at least `t` shares.
 * @param {Array<{ x: bigint, y: bigint }>} shares
 * @returns {bigint}
 */
function shamirReconstruct(shares) {
  const points = shares.map((s) => [s.x, s.y]);
  return lagrangeInterpolateAtZero(points, SHAMIR_PRIME);
}

/**
 * MPC Threshold Decryption context.
 * In a production deployment each `NodeShare` lives on a separate server.
 * `decryptWithThreshold` simulates cooperative 2-of-3 decryption without
 * any single node ever holding the full key.
 */
class MPCThresholdContext {
  /**
   * @param {{ threshold?: number, totalNodes?: number }} [opts]
   */
  constructor(opts = {}) {
    this.threshold = opts.threshold ?? 2;
    this.totalNodes = opts.totalNodes ?? 3;
    this._nodeShares = null; // populated by initKey()
  }

  /**
   * Initialise from a raw key buffer.  Splits the key into shares and
   * distributes them to `totalNodes` virtual nodes.  The original key
   * is never stored after this call.
   * @param {Buffer} keyBuffer
   */
  initKey(keyBuffer) {
    const secret = BigInt('0x' + keyBuffer.toString('hex')) % SHAMIR_PRIME;
    this._nodeShares = shamirSplit(secret, this.threshold, this.totalNodes);
    console.log(
      `[mpc] Key split into ${this.totalNodes} shares ` +
      `(threshold ${this.threshold}-of-${this.totalNodes}).`,
    );
  }

  /**
   * Cooperatively reconstruct the decryption key using `threshold` node
   * shares, then decrypt `encryptedWitness` with AES-256-GCM.
   *
   * @param {Buffer} encryptedWitness - 12-byte IV + ciphertext + 16-byte tag.
   * @param {number[]} [participatingNodes] - Indices (1-based) of nodes that
   *   contribute their share.  Defaults to the first `threshold` nodes.
   * @returns {Buffer} Decrypted witness plaintext.
   */
  decryptWithThreshold(encryptedWitness, participatingNodes) {
    if (!this._nodeShares) {
      throw new Error('[mpc] Key shares not initialised. Call initKey() first.');
    }
    const nodeIndices = participatingNodes ??
      Array.from({ length: this.threshold }, (_, i) => i + 1);

    if (nodeIndices.length < this.threshold) {
      throw new Error(
        `[mpc] Insufficient shares: need ${this.threshold}, got ${nodeIndices.length}.`,
      );
    }

    // Gather the chosen shares (simulate each node contributing its share)
    const selectedShares = nodeIndices.map((idx) => {
      const share = this._nodeShares.find((s) => s.shareIndex === idx);
      if (!share) throw new Error(`[mpc] No share found for node index ${idx}.`);
      return share;
    });

    // Reconstruct secret cooperatively (no single node holds the full secret)
    const reconstructedSecret = shamirReconstruct(selectedShares);
    const keyHex = reconstructedSecret.toString(16).padStart(64, '0');
    const keyBuf = Buffer.from(keyHex, 'hex');

    // Decrypt with AES-256-GCM
    const iv = encryptedWitness.subarray(0, 12);
    const tag = encryptedWitness.subarray(encryptedWitness.length - 16);
    const ciphertext = encryptedWitness.subarray(12, encryptedWitness.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

/**
 * Zero-Knowledge Proof Generation Service
 * Manages a worker pool for generating ZK proofs for privacy-preserving task conditions.
 */
class ZKProofService extends EventEmitter {
  /**
   * Initialize the service with a specific number of workers.
   */
  constructor(workerCount = CPU_CONCURRENCY, options = {}) {
    super();
    this.workerCount = workerCount;
    this.workerMemoryMb = options.workerMemoryMb ?? 4096;
    this.workerTimeoutMs = options.workerTimeoutMs ?? 60000;
    this.workers = [];
    this.isReady = false;
    this.startedAt = null;
    this.asyncJobs = new Map();
    this.proofCache = options.proofCache ?? new ProofCache({ redisUrl: options.redisUrl ?? process.env.REDIS_URL });
    this.inFlightProofs = new Map();
    this.proverQueue = new ProverJobQueue({
      redisUrl: options.redisUrl ?? process.env.REDIS_URL,
      concurrency: CPU_CONCURRENCY,
      processJob: async ({ taskCondition: queuedCondition, clientData: queuedData, circuitId: queuedCircuitId, circuitArtifactHash: queuedArtifactHash }, reportProgress) => {
        reportProgress(25);
        const proof = await this.generateProof(queuedCondition, queuedData, queuedCircuitId, queuedArtifactHash);
        reportProgress(100);
        return { proof, conditionHash: hashTaskCondition(queuedCondition) };
      },
      onProgress: (jobId, progress) => {
        const job = this.asyncJobs.get(jobId);
        if (!job) return;
        job.status = 'processing';
        job.progress = progress;
        this.emit('jobProgress', { jobId, status: job.status, progress });
      },
      onComplete: (jobId, completed) => {
        const job = this.asyncJobs.get(jobId);
        if (!job) return;
        const { proof: rawProof, conditionHash } = completed;
        job.progress = 100;
        job.status = 'completed';
        job.result = {
          proofId: rawProof.proofId,
          status: 'success',
          conditionHash,
          proof: {
            pi_a: rawProof.pi_a,
            pi_b: rawProof.pi_b,
            pi_c: rawProof.pi_c,
            publicSignals: rawProof.publicSignals,
          },
          generatedAt: new Date().toISOString(),
        };
        this.emit('jobComplete', job);
      },
      onError: (jobId, error) => {
        const job = this.asyncJobs.get(jobId);
        if (!job) return;
        job.status = 'failed';
        job.error = error.message;
        this.emit('jobError', job);
      },
    });
  }

  initialize() {
    this.isReady = true;
    this.startedAt = Date.now();
    this.workers = [];
    for (let i = 0; i < this.workerCount; i++) {
      this._spawnWorker(i);
    }
  }

  /**
   * Acquire an idle worker entry for a proof job, marking it active.
   * Returns null when the pool is at capacity.
   * @returns {{ id: number, status: string, worker: Worker, job: object|null } | null}
   */
  _acquireWorker() {
    const entry = this.workers.find((candidate) => candidate.status === 'idle');
    if (!entry) return null;
    entry.status = 'active';
    return entry;
  }

  _spawnWorker(id) {
    const entry = { id, status: 'idle', worker: null, job: null };
    const worker = new Worker(path.join(__dirname, 'lib', 'proof-worker.js'), {
      resourceLimits: { maxOldGenerationSizeMb: this.workerMemoryMb },
    });
    entry.worker = worker;
    worker.on('message', (message) => {
      const job = entry.job;
      if (!job) return;
      clearTimeout(job.timeout);
      entry.job = null;
      entry.status = 'idle';
      if (message.error) job.reject(new Error(`Proof generation failed: ${message.error}`));
      else job.resolve(message.proof);
    });
    worker.on('error', (error) => {
      const job = entry.job;
      if (job) {
        clearTimeout(job.timeout);
        entry.job = null;
        job.reject(this._workerError(error));
      }
      this._replaceWorker(entry);
    });
    worker.on('exit', (code) => {
      if (entry.worker !== worker) return;
      const job = entry.job;
      if (job) {
        clearTimeout(job.timeout);
        entry.job = null;
        job.reject(new Error(`Proof worker exited with code ${code}`));
      }
      if (this.isReady) this._replaceWorker(entry);
    });
    this.workers.push(entry);
  }

  _workerError(error) {
    if (error && error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
      const outOfMemory = new Error('Proof worker exceeded memory limit');
      outOfMemory.code = 'PROVER_MEMORY_LIMIT';
      return outOfMemory;
    }
    return error;
  }

  _replaceWorker(entry) {
    const index = this.workers.indexOf(entry);
    if (index === -1) return;
    this.workers.splice(index, 1);
    if (this.isReady) this._spawnWorker(entry.id);
  }

  getWorkerPoolStatus() {
    const activeWorkers = this.workers.filter((worker) => worker.status === 'active').length;
    return { totalWorkers: this.workers.length, activeWorkers, idleWorkers: this.workers.length - activeWorkers };
  }

  /**
   * Load-balance across the worker pool (Issue #791): picks the first idle
   * worker entry and marks it active before dispatching a job to it.
   *
   * This method was called from `generateProof()` but was never defined —
   * every `/generate-proof` request threw `this._acquireWorker is not a
   * function` at runtime, meaning the worker pool below (which is otherwise
   * fully implemented: spawn, crash-replace, timeout, memory limits) could
   * never actually be reached.
   * Load-balance across the worker pool: picks the first idle worker entry
   * and marks it active before dispatching a job to it.
   *
   * This method was called from `generateProof()` but was never defined —
   * every `/generate-proof` request threw `this._acquireWorker is not a
   * function` at runtime, meaning the worker pool below (spawn,
   * crash-replace, timeout, memory limits) could never actually be reached.
   *
   * @returns {{id: number, status: string, worker: import('worker_threads').Worker, job: object|null}|null}
   */
  _acquireWorker() {
    const entry = this.workers.find((candidate) => candidate.status === 'idle');
    if (!entry) return null;
    entry.status = 'active';
    return entry;
  }

  /**
   * @param {{ id: number }} worker
   */
  _releaseWorker(worker) {
    if (!worker) return;
    const entry = this.workers.find((candidate) => candidate.id === worker.id);
    if (entry) entry.status = 'idle';
  }

  /**
   * Generates a ZK proof for a given task condition and client data.
   * @param {Object} taskCondition - The privacy-preserving condition.
   * @param {Object} clientData - The light client data.
   * @returns {Promise<Object>} The generated proof.
   */
  async generateProof(taskCondition, clientData, circuitId = 'default', circuitArtifactHash = '') {
    if (!this.isReady) {
      throw new Error('Service not initialized');
    }

    if (!taskCondition || !clientData) {
      throw new Error('Invalid input data');
    }

    const cacheKey = createProofCacheKey(circuitId, taskCondition, clientData, circuitArtifactHash);
    const cached = await this.proofCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
    if (this.inFlightProofs.has(cacheKey)) return this.inFlightProofs.get(cacheKey);

    const worker = this._acquireWorker();
    if (!worker) {
      throw new Error('Worker pool at capacity');
    }

    const proofPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.job = null;
        worker.status = 'recycling';
        const error = new Error('Proof generation exceeded 60 seconds');
        error.code = 'PROVER_TIMEOUT';
        reject(error);
        worker.worker.terminate();
      }, this.workerTimeoutMs);
      worker.job = { resolve, reject, timeout };
      worker.worker.postMessage({ taskCondition, clientData });
    });
    this.inFlightProofs.set(cacheKey, proofPromise);
    proofPromise
      .then((proof) => this.proofCache.set(cacheKey, proof).catch(() => {}))
      .finally(() => {
        this.inFlightProofs.delete(cacheKey);
      })
      .catch(() => {});
    return proofPromise;
  }

  async verifyProof({ taskCondition, proof, conditionHash, circuitId }) {
    if (!this.isReady) {
      throw new Error('Service not initialized');
    }

    if (!taskCondition || !proof) {
      throw new Error('Invalid input data');
    }

    const derivedHash = hashTaskCondition(taskCondition);
    const conditionHashMatch = !conditionHash || conditionHash === derivedHash;
    const publicSignalsMatch = isValidZkProof(proof);
    const valid = publicSignalsMatch && conditionHashMatch;

    return {
      valid,
      proofId: proof.proofId,
      conditionHash: derivedHash,
      verificationDetails: {
        circuitId,
        publicSignalsMatch,
        conditionHashMatch,
        ...(valid ? {} : { reason: 'Proof vector verification failed' }),
      },
    };
  }

  /**
   * Enqueues an asynchronous proof generation job.
   * Uses ephemeral directories to isolate proof artifacts and ensure cleanup.
   * @param {Object} taskCondition
   * @param {Object} clientData
   * @param {Object} [options]
   * @returns {Object} Job info containing jobId, status, createdAt.
  enqueueAsyncJob(taskCondition, clientData, circuitId = 'default', circuitArtifactHash = '') {
    if (!this.isReady) {
      throw new Error('Service not initialized');
    }

    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
    };

    this.asyncJobs.set(jobId, job);

    // Process the job through the prover queue (BullMQ when Redis is
    // configured, in-process worker pool otherwise). Progress and completion
    // are surfaced via the jobProgress / jobComplete / jobError events that
    // the SSE stream endpoint subscribes to. No inline processing here so each
    // job is generated exactly once.
    this.proverQueue
      .add(jobId, { taskCondition, clientData, circuitId, circuitArtifactHash })
      .catch((error) => {
        const failed = this.asyncJobs.get(jobId);
        if (failed) {
          failed.status = 'failed';
          failed.error = error.message;
          this.emit('jobError', failed);
        }
      });

    return {
      jobId,
      status: 'queued',
      createdAt: job.createdAt,
    };
  }

  /**
   * Retrieves an asynchronous proof job by ID.
   * @param {string} jobId
   * @returns {Object | null}
   */
  async getAsyncJob(jobId) {
    return this.asyncJobs.get(jobId) || await this.proverQueue.get(jobId);
  }

  /**
   * Safely shuts down the worker pool.
   */
  shutdown() {
    this.isReady = false;
    for (const entry of this.workers) {
      if (entry.job) {
        clearTimeout(entry.job.timeout);
        entry.job.reject(new Error('Service shutting down'));
      }
      entry.worker.terminate();
    }
    this.workers = [];
    this.startedAt = null;
    this.asyncJobs.clear();
    this.inFlightProofs.clear();
    this.proverQueue.close().catch(() => {});
    this.proofCache.close().catch(() => {});
  }
}

module.exports = { ZKProofService };

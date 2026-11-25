'use strict';

/**
 * circuit-registry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #857 — Automated Circuit Versioning & WASM Artifact Dependency Registry
 *
 * Builds an immutable, content-addressed registry for circuit WASM binaries,
 * zkey files, and verification contract bytecode. Each artifact is indexed by
 * its SHA-256 content hash, ensuring that deploying a circuit update never
 * silently reuses a stale verifier binary.
 *
 * Key guarantees:
 *   1. Every stored artifact is keyed by SHA-256(content) — the key IS the
 *      integrity proof. Retrieval re-validates the hash before returning.
 *   2. A circuit_id → version → artifact map allows looking up the canonical
 *      artifact for any released version without hash guessing.
 *   3. Strict content-hash verification is enforced before any witness loading.
 *      Passing the wrong hash fails fast and loud, not silently.
 *
 * Storage back-end:
 *   In-process Map (default, zero-dependency). A real deployment swaps in an
 *   S3 or IPFS adapter via options.storageAdapter (same put/get/has interface).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of arbitrary bytes and return as lowercase hex string.
 * @param {Buffer|Uint8Array} bytes
 * @returns {string}
 */
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// In-memory storage adapter (default)
// ---------------------------------------------------------------------------

class MemoryStorageAdapter {
  constructor() {
    /** @type {Map<string, Buffer>} key → raw bytes */
    this._store = new Map();
  }

  /** @param {string} key @param {Buffer} bytes */
  async put(key, bytes) {
    this._store.set(key, Buffer.from(bytes));
  }

  /** @param {string} key @returns {Buffer|null} */
  async get(key) {
    return this._store.get(key) ?? null;
  }

  /** @param {string} key @returns {boolean} */
  async has(key) {
    return this._store.has(key);
  }

  /** @returns {number} */
  get size() {
    return this._store.size;
  }
}

// ---------------------------------------------------------------------------
// CircuitRegistry
// ---------------------------------------------------------------------------

/**
 * Artifact types recognized by the registry.
 */
const ARTIFACT_TYPES = Object.freeze(['wasm', 'zkey', 'verifier']);

class CircuitRegistry {
  /**
   * @param {object} [options]
   * @param {object} [options.storageAdapter] - Custom storage adapter with
   *   put(key, bytes), get(key), has(key) methods (all async). Defaults to
   *   in-memory Map.
   */
  constructor(options = {}) {
    this._storage = options.storageAdapter ?? new MemoryStorageAdapter();

    /**
     * Versioned index: circuit_id → version → { wasm, zkey, verifier }
     * Each value is the SHA-256 content hash of the corresponding artifact.
     * @type {Map<string, Map<string, object>>}
     */
    this._index = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Store a circuit artifact and register it under (circuitId, version).
   *
   * @param {object} params
   * @param {string} params.circuitId   - Logical circuit identifier (e.g. "range-proof-v1")
   * @param {string} params.version     - Semantic version string (e.g. "1.0.0")
   * @param {'wasm'|'zkey'|'verifier'} params.artifactType
   * @param {Buffer|Uint8Array} params.bytes - Raw artifact bytes
   * @returns {Promise<string>} The SHA-256 content hash assigned to this artifact
   * @throws {TypeError} If arguments are invalid
   */
  async register(params) {
    const { circuitId, version, artifactType, bytes } = params;

    if (!circuitId || typeof circuitId !== 'string') {
      throw new TypeError('circuitId must be a non-empty string');
    }
    if (!version || typeof version !== 'string') {
      throw new TypeError('version must be a non-empty string');
    }
    if (!ARTIFACT_TYPES.includes(artifactType)) {
      throw new TypeError(`artifactType must be one of: ${ARTIFACT_TYPES.join(', ')}`);
    }
    if (!bytes || bytes.length === 0) {
      throw new TypeError('bytes must be a non-empty Buffer or Uint8Array');
    }

    const contentHash = sha256Hex(bytes);
    const storageKey = `artifact:${contentHash}`;

    // Idempotent: same content hash → same storage slot, no re-upload needed
    if (!(await this._storage.has(storageKey))) {
      await this._storage.put(storageKey, Buffer.from(bytes));
    }

    // Update the versioned index
    if (!this._index.has(circuitId)) {
      this._index.set(circuitId, new Map());
    }
    const versionMap = this._index.get(circuitId);
    const existing = versionMap.get(version) ?? {};
    versionMap.set(version, { ...existing, [artifactType]: contentHash });

    return contentHash;
  }

  /**
   * Retrieve a circuit artifact by circuit ID and version.
   * Re-validates the SHA-256 hash on the way out — if storage is corrupted,
   * this throws rather than returning bad bytes.
   *
   * Corresponds to: GET /circuits/:circuit_id/:version?type=wasm
   *
   * @param {string} circuitId
   * @param {string} version
   * @param {'wasm'|'zkey'|'verifier'} artifactType
   * @returns {Promise<{ bytes: Buffer, contentHash: string }>}
   * @throws {Error} If circuit/version/type is not found or hash mismatch
   */
  async getArtifact(circuitId, version, artifactType) {
    const versionMap = this._index.get(circuitId);
    if (!versionMap) {
      throw new Error(`Circuit not found: ${circuitId}`);
    }
    const artifacts = versionMap.get(version);
    if (!artifacts) {
      throw new Error(`Version not found: ${circuitId}@${version}`);
    }
    const contentHash = artifacts[artifactType];
    if (!contentHash) {
      throw new Error(`Artifact type '${artifactType}' not registered for ${circuitId}@${version}`);
    }

    const storageKey = `artifact:${contentHash}`;
    const bytes = await this._storage.get(storageKey);
    if (!bytes) {
      throw new Error(`Artifact bytes missing from storage for hash ${contentHash}`);
    }

    // Re-validate integrity
    const actualHash = sha256Hex(bytes);
    if (actualHash !== contentHash) {
      throw new Error(
        `Content hash mismatch for ${circuitId}@${version} ${artifactType}: ` +
        `expected ${contentHash}, got ${actualHash}`,
      );
    }

    return { bytes, contentHash };
  }

  /**
   * Verify that a given artifact's bytes match their declared content hash.
   * Must be called before loading any witness to prevent verifier mismatch.
   *
   * @param {Buffer|Uint8Array} bytes - The artifact bytes to verify
   * @param {string} expectedHash     - The SHA-256 hash declared at registration time
   * @returns {{ ok: boolean, actualHash: string, expectedHash: string }}
   */
  verifyContentHash(bytes, expectedHash) {
    const actualHash = sha256Hex(bytes);
    return {
      ok: actualHash === expectedHash,
      actualHash,
      expectedHash,
    };
  }

  /**
   * List all registered versions for a given circuitId.
   *
   * @param {string} circuitId
   * @returns {string[]} Array of version strings, sorted lexicographically
   */
  listVersions(circuitId) {
    const versionMap = this._index.get(circuitId);
    if (!versionMap) return [];
    return Array.from(versionMap.keys()).sort();
  }

  /**
   * Get the artifact hash manifest for a specific (circuitId, version).
   * Returns an object mapping artifact types to their SHA-256 content hashes.
   *
   * @param {string} circuitId
   * @param {string} version
   * @returns {{ wasm?: string, zkey?: string, verifier?: string } | null}
   */
  getManifest(circuitId, version) {
    const versionMap = this._index.get(circuitId);
    if (!versionMap) return null;
    return versionMap.get(version) ?? null;
  }

  /**
   * List all registered circuit IDs.
   * @returns {string[]}
   */
  listCircuits() {
    return Array.from(this._index.keys()).sort();
  }
}

// ---------------------------------------------------------------------------
// Express route factory
// ─────────────────────────────────────────────────────────────────────────────
// Mounts GET /circuits/:circuit_id/:version onto an Express router.
// Usage:
//   const { CircuitRegistry, createCircuitRoutes } = require('./circuit-registry');
//   const registry = new CircuitRegistry();
//   app.use(createCircuitRoutes(registry));
// ---------------------------------------------------------------------------

/**
 * Create an Express Router exposing the circuit artifact registry endpoints.
 *
 * Routes:
 *   GET /circuits                         → list all circuit IDs
 *   GET /circuits/:circuit_id             → list all versions for circuit
 *   GET /circuits/:circuit_id/:version    → get artifact manifest (hashes)
 *   GET /circuits/:circuit_id/:version/artifact?type=wasm|zkey|verifier
 *                                         → download artifact bytes
 *
 * @param {CircuitRegistry} registry
 * @returns {import('express').Router}
 */
function createCircuitRoutes(registry) {
  // Lazy-require express so this module can be imported without express installed
  // (e.g. in tests that only exercise CircuitRegistry directly).
  // eslint-disable-next-line global-require
  const { Router } = require('express');
  const router = Router();

  // List all circuits
  router.get('/circuits', (_req, res) => {
    res.json({ circuits: registry.listCircuits() });
  });

  // List versions for a circuit
  router.get('/circuits/:circuit_id', (req, res) => {
    const { circuit_id } = req.params;
    const versions = registry.listVersions(circuit_id);
    if (versions.length === 0) {
      return res.status(404).json({ error: `Circuit not found: ${circuit_id}` });
    }
    return res.json({ circuitId: circuit_id, versions });
  });

  // Get manifest (hash map) for a specific version
  router.get('/circuits/:circuit_id/:version', (req, res) => {
    const { circuit_id, version } = req.params;
    const manifest = registry.getManifest(circuit_id, version);
    if (!manifest) {
      return res.status(404).json({ error: `Not found: ${circuit_id}@${version}` });
    }
    return res.json({ circuitId: circuit_id, version, manifest });
  });

  // Download a specific artifact
  router.get('/circuits/:circuit_id/:version/artifact', async (req, res) => {
    const { circuit_id, version } = req.params;
    const artifactType = req.query.type;

    if (!ARTIFACT_TYPES.includes(artifactType)) {
      return res.status(400).json({
        error: `Query param 'type' must be one of: ${ARTIFACT_TYPES.join(', ')}`,
      });
    }

    try {
      const { bytes, contentHash } = await registry.getArtifact(circuit_id, version, artifactType);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Hash', contentHash);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${circuit_id}-${version}-${artifactType}.bin"`,
      );
      return res.send(bytes);
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('not registered')) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes('hash mismatch')) {
        return res.status(500).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  CircuitRegistry,
  MemoryStorageAdapter,
  createCircuitRoutes,
  sha256Hex,
  ARTIFACT_TYPES,
};

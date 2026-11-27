'use strict';

/**
 * ceremonyCoordinator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #BE-FINAL-24 — Zero-Knowledge Trusted Setup Ceremony Coordinator &
 * ZKey Integrity Checksum Validator
 *
 * A trusted-setup ceremony produces Groth16 proving keys (`.zkey`) and a
 * Powers-of-Tau (`.ptau`) transcript. If a proving key is corrupt or has been
 * swapped for a malicious one, every proof the service emits becomes unsound —
 * silently. This module makes that failure impossible to miss:
 *
 *   1. The canonical SHA-256 checksums of the released ceremony artifacts are
 *      read from an *immutable* registry (in production, fetched from the
 *      on-chain ceremony registry contract via `registryProvider`).
 *   2. At startup every proving key on disk is audited against that registry.
 *   3. Any mismatch, missing artifact, or unregistered key aborts startup with
 *      a descriptive `ZKeyIntegrityError` — fail-closed, never fail-open.
 *   4. Each artifact that passes emits a cryptographic verification log line
 *      carrying its SHA-256 digest.
 *
 * Storage of the registry is deliberately pluggable: tests and deployments may
 * inject a static map or an async provider (on-chain read) without touching the
 * verification logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised whenever a proving key fails integrity attestation. Distinct type so
 * callers can distinguish a security abort from an ordinary I/O failure.
 */
class ZKeyIntegrityError extends Error {
  /**
   * @param {string} message
   * @param {{ file?: string, reason?: string, expected?: string, actual?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ZKeyIntegrityError';
    this.code = 'ZKEY_INTEGRITY_FAILURE';
    Object.assign(this, details);
  }
}

// ---------------------------------------------------------------------------
// Low-level checksum primitives
// ---------------------------------------------------------------------------

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Compute the SHA-256 digest of a file at `filePath`, streaming the file so
 * that multi-gigabyte Powers-of-Tau transcripts never have to be buffered.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Lowercase hex-encoded digest.
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
 * checksums from the official ceremony records. Throws on the first failure.
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
// CeremonyCoordinator
// ---------------------------------------------------------------------------

/**
 * Normalise a registry key so on-disk and registry paths compare identically
 * across platforms (Windows backslashes, leading `./`, etc.).
 * @param {string} key
 * @returns {string}
 */
function normalizeRegistryKey(key) {
  return String(key).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Coordinates the trusted-setup ceremony: owns the immutable proving-key
 * registry and audits every local `.zkey` against it at startup.
 */
class CeremonyCoordinator {
  /**
   * @param {object} [options]
   * @param {string} [options.circuitsDir] - Directory holding circuit artifacts.
   * @param {string[]} [options.provingKeyExtensions] - File extensions treated
   *   as proving keys (default `['.zkey']`).
   * @param {object|Map<string,string>} [options.registry] - Static registry of
   *   `relativePath → sha256`.
   * @param {() => (object|Map<string,string>|Promise<object|Map<string,string>>)}
   *   [options.registryProvider] - Async loader (e.g. on-chain registry read).
   *   Takes precedence over `registry` when both are supplied.
   * @param {object} [options.logger] - Logger with info/warn/error methods.
   */
  constructor(options = {}) {
    this.circuitsDir = options.circuitsDir || path.join(__dirname, '..', 'circuits');
    this.provingKeyExtensions = options.provingKeyExtensions || ['.zkey'];
    this.registry = options.registry || null;
    this.registryProvider = options.registryProvider || null;
    this.logger = options.logger || console;

    /** @type {object|null} Frozen registry, populated lazily. */
    this._registry = null;
    /** @type {Promise<object>|null} In-flight load (single-flight). */
    this._registryPromise = null;
    /** @type {Promise<object>|null} In-flight audit (single-flight). */
    this._auditPromise = null;
    /** @type {object|null} Result of the most recent successful audit. */
    this._lastAudit = null;
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  /**
   * Load, validate, and freeze the proving-key registry. Repeated and
   * concurrent calls share a single load (the registry is immutable, so it is
   * also cached for the lifetime of the coordinator).
   *
   * @returns {Promise<Readonly<object>>} Frozen `relativePath → sha256` map.
   * @throws {ZKeyIntegrityError} When no registry is configured or an entry is
   *   malformed.
   */
  async loadRegistry() {
    if (this._registry) return this._registry;
    if (this._registryPromise) return this._registryPromise;

    this._registryPromise = (async () => {
      let source;
      if (this.registryProvider) {
        source = await this.registryProvider();
      } else if (this.registry) {
        source = this.registry;
      } else {
        throw new ZKeyIntegrityError(
          '[ceremony] No proving-key registry configured. Cannot attest .zkey ' +
          'integrity against the on-chain registry. Aborting startup (fail-closed).',
          { reason: 'no-registry' },
        );
      }

      const normalized = this._normalizeRegistry(source);
      this._registry = Object.freeze(normalized);
      this.logger.info(
        `[ceremony] Immutable proving-key registry loaded ` +
        `(${Object.keys(this._registry).length} artifact(s)).`,
      );
      return this._registry;
    })();

    try {
      return await this._registryPromise;
    } finally {
      this._registryPromise = null;
    }
  }

  /**
   * Validate and normalise a raw registry into `relativePath → sha256`.
   * @param {object|Map<string,string>} source
   * @returns {object}
   * @private
   */
  _normalizeRegistry(source) {
    if (!source || typeof source !== 'object') {
      throw new ZKeyIntegrityError(
        '[ceremony] Registry must be an object or Map of relativePath → sha256.',
        { reason: 'invalid-registry' },
      );
    }

    const entries = source instanceof Map ? source.entries() : Object.entries(source);
    const out = {};

    for (const [key, value] of entries) {
      const sha256 = typeof value === 'string' ? value : value && value.sha256;
      if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256.toLowerCase())) {
        throw new ZKeyIntegrityError(
          `[ceremony] Invalid registry entry for '${key}': expected a 64-character ` +
          'hex SHA-256 digest.',
          { reason: 'invalid-entry', file: String(key) },
        );
      }
      out[normalizeRegistryKey(key)] = sha256.toLowerCase();
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /**
   * Recursively discover proving-key artifacts under `dir`.
   *
   * @param {string} [dir] - Directory to scan (defaults to `circuitsDir`).
   * @returns {string[]} Sorted list of absolute file paths.
   */
  discoverProvingKeys(dir = this.circuitsDir) {
    if (!fs.existsSync(dir)) return [];

    const found = [];
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.isFile() &&
          this.provingKeyExtensions.includes(path.extname(entry.name).toLowerCase())
        ) {
          found.push(full);
        }
      }
    };
    walk(dir);

    return found.sort();
  }

  /**
   * Registry key for a given artifact path.
   * @param {string} filePath
   * @returns {string}
   * @private
   */
  _relativeKey(filePath) {
    return normalizeRegistryKey(path.relative(this.circuitsDir, filePath));
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Verify a single proving key against its expected SHA-256 digest.
   *
   * @param {string} file - Absolute path to the artifact.
   * @param {string} expectedSha256 - Expected lowercase hex digest.
   * @returns {Promise<{ file: string, sha256: string }>}
   * @throws {ZKeyIntegrityError} If the file is missing or the digest differs.
   */
  async verifyProvingKey(file, expectedSha256) {
    if (!fs.existsSync(file)) {
      throw new ZKeyIntegrityError(
        `[ceremony] Proving key not found: ${file}. The registered artifact is ` +
        'missing — refusing to start to prevent unsound proof generation.',
        { reason: 'missing', file, expected: expectedSha256 },
      );
    }

    const actual = await computeFileSha256(file);
    if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
      throw new ZKeyIntegrityError(
        `[ceremony] Checksum mismatch for ${path.basename(file)}. ` +
        `Expected ${expectedSha256} but got ${actual}. The proving key may be ` +
        'corrupted or tampered with — aborting startup.',
        { reason: 'mismatch', file, expected: expectedSha256, actual },
      );
    }

    this.logger.info(
      `[ceremony] ✓ ${this._relativeKey(file)} proven sound ` +
      `(SHA-256: ${actual})`,
    );
    return { file, sha256: actual };
  }

  // -------------------------------------------------------------------------
  // Startup audit
  // -------------------------------------------------------------------------

  /**
   * Audit every proving key against the immutable registry. Fail-closed: any
   * unregistered key, missing artifact, or checksum mismatch throws. Repeated
   * and concurrent invocations share a single audit run.
   *
   * @returns {Promise<{ ok: true, verifiedCount: number, verified: Array, auditedAt: string }>}
   * @throws {ZKeyIntegrityError} When attestation fails.
   */
  async auditAtStartup() {
    if (this._auditPromise) return this._auditPromise;
    this._auditPromise = this._runAudit();
    try {
      return await this._auditPromise;
    } finally {
      this._auditPromise = null;
    }
  }

  /**
   * @returns {Promise<object>}
   * @private
   */
  async _runAudit() {
    const registry = await this.loadRegistry();
    const registryKeys = Object.keys(registry).sort();

    // 1. Fail-closed on any unregistered proving key present on disk.
    const localKeys = this.discoverProvingKeys();
    const registered = new Set(registryKeys);
    for (const file of localKeys) {
      const rel = this._relativeKey(file);
      if (!registered.has(rel)) {
        const err = new ZKeyIntegrityError(
          `[ceremony] Unregistered proving key: ${rel}. It is absent from the ` +
          'on-chain registry — refusing to start (fail-closed).',
          { reason: 'unregistered', file },
        );
        this.logger.error(`[ceremony] ✗ ${err.message}`);
        throw err;
      }
    }

    this.logger.info(
      `[ceremony] Auditing ${registryKeys.length} proving key(s) against the ` +
      'immutable on-chain registry…',
    );

    // 2. Every registered artifact must exist and match its digest.
    const verified = [];
    for (const rel of registryKeys) {
      const file = path.join(this.circuitsDir, rel);
      try {
        const { sha256 } = await this.verifyProvingKey(file, registry[rel]);
        verified.push({ file, relativePath: rel, sha256 });
      } catch (err) {
        this.logger.error(`[ceremony] ✗ ${err.message}`);
        throw err;
      }
    }

    const summary = {
      ok: true,
      verifiedCount: verified.length,
      verified,
      auditedAt: new Date().toISOString(),
    };
    this._lastAudit = summary;
    this.logger.info(
      `[ceremony] Trusted-setup audit PASSED — ${verified.length} proving key(s) ` +
      'verified, 0 tampered.',
    );
    return summary;
  }

  /**
   * Result of the most recent successful audit, or null.
   * @returns {object|null}
   */
  getLastAudit() {
    return this._lastAudit;
  }

  /**
   * The frozen registry, or null if it has not been loaded yet.
   * @returns {Readonly<object>|null}
   */
  getRegistry() {
    return this._registry;
  }
}

module.exports = {
  CeremonyCoordinator,
  ZKeyIntegrityError,
  computeFileSha256,
  auditZkeyChecksums,
};

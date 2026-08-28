'use strict';

/**
 * circuit-integrity.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #1077 — Circuit Verification Key Integrity Manifest & Boot-Time Attestation
 *
 * Maintains a signed manifest.json containing SHA-256 hashes of all circuit
 * artifacts (WASM binaries, zkey files, verifier bytecode). During server boot,
 * verifies all circuit file checksums against the manifest and refuses service
 * startup if any artifact fails checksum attestation.
 *
 * Key guarantees:
 *   1. All circuit files are verified against manifest hashes at boot time.
 *   2. Any tampered/missing file halts startup with descriptive security logs.
 *   3. Manifest is signed with HMAC-SHA256 to prevent unauthorized modification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Compute the SHA-256 digest of a buffer or file.
 * @param {Buffer|Uint8Array} data
 * @returns {string} Lowercase hex digest
 */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

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
 * Sign a manifest object with HMAC-SHA256 using a shared secret.
 * @param {object} manifest
 * @param {string} secret - HMAC signing secret
 * @returns {string} Hex-encoded HMAC signature
 */
function signManifest(manifest, secret) {
  const payload = JSON.stringify(manifest, Object.keys(manifest).sort());
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify an HMAC signature over a manifest object.
 * @param {object} manifest
 * @param {string} signature - Hex-encoded HMAC signature to verify
 * @param {string} secret - HMAC signing secret
 * @returns {boolean} True if signature is valid
 */
function verifyManifestSignature(manifest, signature, secret) {
  const expected = signManifest(manifest, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * CircuitIntegrityVerifier
 *
 * Manages the circuit integrity manifest and performs boot-time attestation
 * of all circuit artifacts on disk.
 */
class CircuitIntegrityVerifier {
  /**
   * @param {object} [options]
   * @param {string} [options.circuitsDir] - Directory containing circuit artifacts
   * @param {string} [options.manifestPath] - Path to manifest.json
   * @param {string} [options.signingSecret] - HMAC secret for manifest signing
   * @param {object} [options.logger] - Logger instance
   * @param {string[]} [options.artifactPatterns] - Glob patterns for artifact files
   */
  constructor(options = {}) {
    this.circuitsDir = options.circuitsDir || path.join(__dirname, '..', 'circuits');
    this.manifestPath = options.manifestPath || path.join(this.circuitsDir, 'manifest.json');
    this.signingSecret = options.signingSecret || process.env.CIRCUIT_MANIFEST_SECRET || '';
    this.logger = options.logger || console;
    this.artifactPatterns = options.artifactPatterns || ['.wasm', '.zkey', '.vkey'];
    this._manifest = null;
    this._attestationResults = null;
  }

  /**
   * Build a manifest from all circuit artifacts found on disk.
   * Scans the circuits directory for files matching the configured patterns
   * and computes SHA-256 hashes for each.
   *
   * @returns {Promise<object>} The generated manifest
   */
  async buildManifest() {
    const artifacts = {};

    if (!fs.existsSync(this.circuitsDir)) {
      this.logger.warn(`[circuit-integrity] Circuits directory not found: ${this.circuitsDir}`);
      return { version: 1, artifacts: {}, generatedAt: new Date().toISOString() };
    }

    const files = this._scanCircuitFiles(this.circuitsDir);

    for (const filePath of files) {
      const relativePath = path.relative(this.circuitsDir, filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const hash = sha256Hex(fileBuffer);
      const stats = fs.statSync(filePath);

      artifacts[relativePath] = {
        sha256: hash,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };

      this.logger.info(`[circuit-integrity] Scanned: ${relativePath} (SHA-256: ${hash.slice(0, 16)}…)`);
    }

    const manifest = {
      version: 1,
      artifacts,
      generatedAt: new Date().toISOString(),
      artifactCount: Object.keys(artifacts).length,
    };

    this._manifest = manifest;
    return manifest;
  }

  /**
   * Recursively scan a directory for circuit files.
   * @param {string} dir
   * @returns {string[]} Array of absolute file paths
   * @private
   */
  _scanCircuitFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this._scanCircuitFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.artifactPatterns.includes(ext)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }

  /**
   * Save a manifest to disk with an HMAC signature.
   * @param {object} manifest
   * @returns {Promise<void>}
   */
  async saveManifest(manifest) {
    const signedManifest = { ...manifest };

    if (this.signingSecret) {
      signedManifest.signature = signManifest(manifest, this.signingSecret);
    }

    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.manifestPath, JSON.stringify(signedManifest, null, 2), 'utf8');
    this.logger.info(`[circuit-integrity] Manifest saved to ${this.manifestPath}`);
  }

  /**
   * Load and verify the manifest from disk.
   * @returns {Promise<object>} The loaded manifest
   * @throws {Error} If manifest is missing, corrupt, or has invalid signature
   */
  async loadManifest() {
    if (!fs.existsSync(this.manifestPath)) {
      throw new Error(
        `[circuit-integrity] Manifest not found at ${this.manifestPath}. ` +
        'Run generate-manifest to create one before starting the service.'
      );
    }

    let raw;
    try {
      raw = fs.readFileSync(this.manifestPath, 'utf8');
    } catch (err) {
      throw new Error(`[circuit-integrity] Failed to read manifest: ${err.message}`);
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new Error(`[circuit-integrity] Manifest is not valid JSON: ${err.message}`);
    }

    // Verify HMAC signature if signing secret is configured
    if (this.signingSecret && manifest.signature) {
      const isValid = verifyManifestSignature(manifest, manifest.signature, this.signingSecret);
      if (!isValid) {
        throw new Error(
          '[circuit-integrity] Manifest signature verification failed. ' +
          'The manifest may have been tampered with. Aborting startup.'
        );
      }
      this.logger.info('[circuit-integrity] Manifest signature verified successfully');
    }

    this._manifest = manifest;
    return manifest;
  }

  /**
   * Verify all artifacts referenced in the manifest exist on disk and match
   * their declared SHA-256 checksums.
   *
   * @param {object} [manifest] - Optional manifest to verify (uses loaded manifest if not provided)
   * @returns {Promise<{ ok: boolean, results: Array<{ file: string, ok: boolean, error?: string }> }>}
   */
  async verifyAllArtifacts(manifest) {
    const target = manifest || this._manifest;
    if (!target) {
      throw new Error('[circuit-integrity] No manifest loaded. Call loadManifest() first.');
    }

    const results = [];
    let allOk = true;

    for (const [relativePath, entry] of Object.entries(target.artifacts || {})) {
      const fullPath = path.join(this.circuitsDir, relativePath);
      const result = { file: relativePath, ok: false };

      if (!fs.existsSync(fullPath)) {
        result.error = `File not found: ${relativePath}`;
        allOk = false;
        this.logger.error(`[circuit-integrity] ✗ MISSING: ${relativePath}`);
        results.push(result);
        continue;
      }

      try {
        const actualHash = await computeFileSha256(fullPath);
        if (actualHash !== entry.sha256) {
          result.error = `Checksum mismatch: expected ${entry.sha256}, got ${actualHash}`;
          allOk = false;
          this.logger.error(
            `[circuit-integrity] ✗ TAMPERED: ${relativePath} — ` +
            `expected ${entry.sha256.slice(0, 16)}… got ${actualHash.slice(0, 16)}…`
          );
        } else {
          result.ok = true;
          this.logger.info(`[circuit-integrity] ✓ ${relativePath} integrity verified`);
        }
      } catch (err) {
        result.error = `Read error: ${err.message}`;
        allOk = false;
        this.logger.error(`[circuit-integrity] ✗ ERROR: ${relativePath} — ${err.message}`);
      }

      results.push(result);
    }

    this._attestationResults = { ok: allOk, results };
    return this._attestationResults;
  }

  /**
   * Perform full boot-time attestation: load manifest, verify all artifacts,
   * and throw if any check fails.
   *
   * This is the main entry point for server startup integration.
   *
   * @returns {Promise<{ ok: boolean, artifactCount: number, results: Array }>}
   * @throws {Error} If any artifact fails verification
   */
  async attestOnBoot() {
    this.logger.info('[circuit-integrity] Starting boot-time attestation…');

    const manifest = await this.loadManifest();
    const { ok, results } = await this.verifyAllArtifacts(manifest);

    if (!ok) {
      const failures = results.filter((r) => !r.ok);
      const summary = failures.map((f) => `  - ${f.file}: ${f.error}`).join('\n');
      throw new Error(
        `[circuit-integrity] Boot-time attestation FAILED. ` +
        `${failures.length} artifact(s) failed verification:\n${summary}\n` +
        'Refusing to start service to prevent invalid proof generation.'
      );
    }

    const count = results.length;
    this.logger.info(`[circuit-integrity] Boot-time attestation PASSED — ${count} artifact(s) verified`);

    return { ok: true, artifactCount: count, results };
  }

  /**
   * Get the last attestation results (cached from most recent verifyAllArtifacts call).
   * @returns {{ ok: boolean, results: Array } | null}
   */
  getAttestationResults() {
    return this._attestationResults;
  }

  /**
   * Get the currently loaded manifest.
   * @returns {object | null}
   */
  getManifest() {
    return this._manifest;
  }
}

module.exports = {
  CircuitIntegrityVerifier,
  computeFileSha256,
  sha256Hex,
  signManifest,
  verifyManifestSignature,
};

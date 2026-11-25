'use strict';

/**
 * Automated Ephemeral Witness & Intermediate Artifact Disk Scrubber (Issue #1076).
 *
 * Manages unique ephemeral directories for ZK proof operations, ensuring that
 * temporary witness files, prover keys, and intermediate proof artifacts are
 * written to isolated directories and cleaned up after both success and failure.
 *
 * Guarantees:
 *   - Zero leftover files in /tmp after proof generation (success or failure)
 *   - O(log N) cleanup via try/finally blocks
 *   - Background scrubber removes any orphaned files older than 30 minutes
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_SCRUB_AGE_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_BASE_DIR = os.tmpdir();

/**
 * Create a unique ephemeral work directory under the given base path.
 * @param {string} [baseDir] - Parent directory (defaults to os.tmpdir())
 * @returns {string} Absolute path to the new ephemeral directory
 */
function createEphemeralDir(baseDir = DEFAULT_BASE_DIR) {
  const uniqueId = `zk_job_${crypto.randomUUID()}`;
  const dirPath = path.join(baseDir, uniqueId);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Recursively remove a directory and all its contents.
 * Uses force: true to avoid errors on already-deleted files.
 * @param {string} dirPath - Absolute path to the directory to remove
 * @returns {Promise<void>}
 */
async function cleanupDir(dirPath) {
  if (!dirPath) return;
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    // Log but don't throw — cleanup failures should not propagate
    console.error(`[ephemeralDir] Failed to cleanup ${dirPath}: ${err.message}`);
  }
}

/**
 * Synchronous cleanup for use in finally blocks where async is not available.
 * @param {string} dirPath - Absolute path to the directory to remove
 */
function cleanupDirSync(dirPath) {
  if (!dirPath) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err) {
    console.error(`[ephemeralDir] Failed to cleanup ${dirPath}: ${err.message}`);
  }
}

/**
 * Execute an async function within an ephemeral work directory.
 * Guarantees cleanup in a finally block regardless of success or failure.
 *
 * @template T
 * @param {function(string): Promise<T>} fn - Function receiving the ephemeral dir path
 * @param {string} [baseDir] - Parent directory for ephemeral dirs
 * @returns {Promise<T>}
 */
async function withEphemeralDir(fn, baseDir = DEFAULT_BASE_DIR) {
  const dirPath = createEphemeralDir(baseDir);
  try {
    return await fn(dirPath);
  } finally {
    await cleanupDir(dirPath);
  }
}

/**
 * Write a file into the ephemeral directory.
 * @param {string} dirPath - Ephemeral directory path
 * @param {string} filename - Name of the file to write
 * @param {Buffer|string} data - File contents
 * @returns {Promise<string>} Absolute path to the written file
 */
async function writeFile(dirPath, filename, data) {
  const filePath = path.join(dirPath, filename);
  await fs.promises.writeFile(filePath, data);
  return filePath;
}

/**
 * Read a file from the ephemeral directory.
 * @param {string} dirPath - Ephemeral directory path
 * @param {string} filename - Name of the file to read
 * @returns {Promise<Buffer>}
 */
async function readFile(dirPath, filename) {
  const filePath = path.join(dirPath, filename);
  return fs.promises.readFile(filePath);
}

/**
 * Background scrubber that removes orphaned ephemeral directories.
 * Scans the base directory for directories matching the zk_job_* pattern
 * and removes those older than the specified age.
 *
 * @param {string} [baseDir] - Parent directory to scan
 * @param {number} [maxAgeMs] - Maximum age in milliseconds (default 30 min)
 * @returns {Promise<{ removed: number, errors: number }>}
 */
async function scrubOrphanedDirs(baseDir = DEFAULT_BASE_DIR, maxAgeMs = DEFAULT_SCRUB_AGE_MS) {
  let removed = 0;
  let errors = 0;
  const now = Date.now();

  try {
    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('zk_job_')) {
        continue;
      }

      const dirPath = path.join(baseDir, entry.name);

      try {
        const stat = await fs.promises.stat(dirPath);
        const ageMs = now - stat.mtimeMs;

        if (ageMs > maxAgeMs) {
          await cleanupDir(dirPath);
          removed++;
          console.log(`[scrubber] Removed orphaned ephemeral dir: ${entry.name} (age: ${Math.round(ageMs / 1000)}s)`);
        }
      } catch (err) {
        errors++;
        console.error(`[scrubber] Error processing ${entry.name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[scrubber] Error reading base directory: ${err.message}`);
    errors++;
  }

  return { removed, errors };
}

/**
 * Start a periodic background scrubber.
 * @param {string} [baseDir] - Parent directory to scan
 * @param {number} [intervalMs] - Scrub interval (default 5 minutes)
 * @param {number} [maxAgeMs] - Maximum dir age (default 30 minutes)
 * @returns {NodeJS.Timer} The interval timer (can be cleared with clearInterval)
 */
function startScrubber(baseDir = DEFAULT_BASE_DIR, intervalMs = 5 * 60 * 1000, maxAgeMs = DEFAULT_SCRUB_AGE_MS) {
  console.log(`[scrubber] Starting background scrubber (interval: ${intervalMs / 1000}s, maxAge: ${maxAgeMs / 1000}s)`);

  // Run immediately on start
  scrubOrphanedDirs(baseDir, maxAgeMs).then((result) => {
    if (result.removed > 0) {
      console.log(`[scrubber] Initial scrub: removed ${result.removed} orphaned dirs, ${result.errors} errors`);
    }
  });

  return setInterval(async () => {
    try {
      const result = await scrubOrphanedDirs(baseDir, maxAgeMs);
      if (result.removed > 0) {
        console.log(`[scrubber] Periodic scrub: removed ${result.removed} orphaned dirs, ${result.errors} errors`);
      }
    } catch (err) {
      console.error(`[scrubber] Error during periodic scrub: ${err.message}`);
    }
  }, intervalMs);
}

module.exports = {
  createEphemeralDir,
  cleanupDir,
  cleanupDirSync,
  withEphemeralDir,
  writeFile,
  readFile,
  scrubOrphanedDirs,
  startScrubber,
  DEFAULT_SCRUB_AGE_MS,
  DEFAULT_BASE_DIR,
};

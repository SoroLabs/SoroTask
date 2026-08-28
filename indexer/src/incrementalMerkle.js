"use strict";

/**
 * Incremental Append-Only Merkle Tree Storage & Audit Proof Cache (Issue #1069).
 *
 * An append-only Merkle tree that persists intermediate branch hashes in
 * PostgreSQL (or SQLite for single-node deployments). Inserting a new leaf
 * requires only O(log N) updates instead of a full O(N) rebuild.
 *
 * Tree layout follows the same sorted-pair SHA-256 convention as merkle.js.
 * Nodes are stored with a `(tree_id, level, position)` composite key.
 */

const crypto = require("crypto");
const { hashEvent } = require("./merkle");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function hashPair(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  const [lo, hi] = Buffer.compare(bufA, bufB) <= 0 ? [bufA, bufB] : [bufB, bufA];
  return sha256(Buffer.concat([lo, hi])).toString("hex");
}

/**
 * SQL to create the incremental Merkle tree node storage table.
 * Each node is identified by (tree_id, level, position).
 * level 0 = leaves, level 1 = first internal layer, ..., top = root.
 */
const CREATE_TREE_NODES_SQL = `
  CREATE TABLE IF NOT EXISTS merkle_tree_nodes (
    tree_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    position INTEGER NOT NULL,
    hash TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tree_id, level, position)
  )
`;

/**
 * SQL to create the leaf-to-event mapping table for fast lookups.
 */
const CREATE_LEAF_MAP_SQL = `
  CREATE TABLE IF NOT EXISTS merkle_leaf_map (
    tree_id TEXT NOT NULL,
    leaf_index INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    leaf_hash TEXT NOT NULL,
    PRIMARY KEY (tree_id, leaf_index)
  )
`;

/**
 * SQL to store audit proof cache for fast repeated lookups.
 */
const CREATE_PROOF_CACHE_SQL = `
  CREATE TABLE IF NOT EXISTS merkle_proof_cache (
    tree_id TEXT NOT NULL,
    leaf_index INTEGER NOT NULL,
    proof_json TEXT NOT NULL,
    root_hash TEXT NOT NULL,
    cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tree_id, leaf_index)
  )
`;

async function ensureIncrementalSchema({ queryRun }) {
  await queryRun(CREATE_TREE_NODES_SQL);
  await queryRun(CREATE_LEAF_MAP_SQL);
  await queryRun(CREATE_PROOF_CACHE_SQL);
}

/**
 * IncrementalMerkleTree manages an append-only Merkle tree backed by database
 * storage for intermediate branch hashes.
 */
class IncrementalMerkleTree {
  /**
   * @param {object} deps - { queryRun, queryGet, queryAll }
   * @param {string} treeId - Unique identifier for this tree (e.g. "ledger:12345")
   */
  constructor(deps, treeId) {
    this.deps = deps;
    this.treeId = treeId;
  }

  /**
   * Get the current leaf count for this tree.
   * @returns {Promise<number>}
   */
  async getLeafCount() {
    const row = await this.deps.queryGet(
      "SELECT COUNT(*) as cnt FROM merkle_leaf_map WHERE tree_id = ?",
      [this.treeId],
    );
    return row ? row.cnt : 0;
  }

  /**
   * Get a cached node hash from the database.
   * @param {number} level
   * @param {number} position
   * @returns {Promise<string|null>}
   */
  async getNode(level, position) {
    const row = await this.deps.queryGet(
      "SELECT hash FROM merkle_tree_nodes WHERE tree_id = ? AND level = ? AND position = ?",
      [this.treeId, level, position],
    );
    return row ? row.hash : null;
  }

  /**
   * Store a node hash in the database.
   * @param {number} level
   * @param {number} position
   * @param {string} hash - hex-encoded hash
   */
  async setNode(level, position, hash) {
    await this.deps.queryRun(
      `INSERT INTO merkle_tree_nodes (tree_id, level, position, hash, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (tree_id, level, position) DO UPDATE SET
         hash = excluded.hash,
         updated_at = CURRENT_TIMESTAMP`,
      [this.treeId, level, position, hash],
    );
  }

  /**
   * Append a single event leaf to the tree. Updates only the O(log N) affected
   * branch nodes, not the entire tree.
   *
   * @param {object} event - The event record to hash as a leaf.
   * @returns {Promise<{ leafIndex: number, leafHash: string, root: string }>}
   */
  async appendLeaf(event) {
    const leafCount = await this.getLeafCount();
    const leafIndex = leafCount;
    const leafHash = hashEvent(event);

    // Store the leaf node at level 0
    await this.setNode(0, leafIndex, leafHash);

    // Store the leaf-to-event mapping
    await this.deps.queryRun(
      "INSERT INTO merkle_leaf_map (tree_id, leaf_index, event_id, leaf_hash) VALUES (?, ?, ?, ?)",
      [this.treeId, leafIndex, event.id, leafHash],
    );

    // Update affected branch nodes: O(log N) updates
    let currentLevel = 0;
    let currentPos = leafIndex;

    while (true) {
      const siblingPos = currentPos % 2 === 0 ? currentPos + 1 : currentPos - 1;
      const siblingHash = await this.getNode(currentLevel, siblingPos);

      if (!siblingHash) {
        // No sibling yet (odd node at this level) — promote current hash up
        const parentHash = await this.getNode(currentLevel, currentPos);
        const nextLevel = currentLevel + 1;
        const parentPos = Math.floor(currentPos / 2);
        await this.setNode(nextLevel, parentPos, parentHash);
        currentLevel = nextLevel;
        currentPos = parentPos;
        break;
      }

      // Both children exist — compute parent
      const currentHash = await this.getNode(currentLevel, currentPos);
      const parentHash = hashPair(currentHash, siblingHash);
      const nextLevel = currentLevel + 1;
      const parentPos = Math.floor(currentPos / 2);
      await this.setNode(nextLevel, parentPos, parentHash);

      // Invalidate cached proof for the affected leaf
      await this.deps.queryRun(
        "DELETE FROM merkle_proof_cache WHERE tree_id = ?",
        [this.treeId],
      );

      currentLevel = nextLevel;
      currentPos = parentPos;
    }

    // Walk up to root to return it
    const root = await this.getRoot();
    return { leafIndex, leafHash, root };
  }

  /**
   * Get the current root hash of the tree.
   * @returns {Promise<string|null>}
   */
  async getRoot() {
    const leafCount = await this.getLeafCount();
    if (leafCount === 0) return null;

    // Find the highest level that has nodes
    const row = await this.deps.queryGet(
      "SELECT level, MAX(position) as maxPos FROM merkle_tree_nodes WHERE tree_id = ? GROUP BY level ORDER BY level DESC LIMIT 1",
      [this.treeId],
    );
    if (!row) return null;
    return this.getNode(row.level, row.maxPos);
  }

  /**
   * Get the leaf hash for a given event ID.
   * @param {number} eventId
   * @returns {Promise<{ leafIndex: number, leafHash: string }|null>}
   */
  async getLeafByEventId(eventId) {
    const row = await this.deps.queryGet(
      "SELECT leaf_index, leaf_hash FROM merkle_leaf_map WHERE tree_id = ? AND event_id = ?",
      [this.treeId, eventId],
    );
    return row ? { leafIndex: row.leaf_index, leafHash: row.leaf_hash } : null;
  }

  /**
   * Build an inclusion proof for a leaf at the given index by reading cached
   * branch nodes from the database. This is O(log N) database reads with no
   * tree rebuild required.
   *
   * @param {number} leafIndex
   * @returns {Promise<string[]>} Array of sibling hashes from leaf level up.
   */
  async getProof(leafIndex) {
    const proof = [];
    let currentPos = leafIndex;
    let currentLevel = 0;

    while (true) {
      const siblingPos = currentPos % 2 === 0 ? currentPos + 1 : currentPos - 1;
      const siblingHash = await this.getNode(currentLevel, siblingPos);

      if (siblingHash) {
        proof.push(siblingHash);
      }

      const parentPos = Math.floor(currentPos / 2);
      const parentHash = await this.getNode(currentLevel + 1, parentPos);
      if (!parentHash) break;

      currentLevel++;
      currentPos = parentPos;
    }

    return proof;
  }

  /**
   * Serve an inclusion proof, using the cache when available. Falls back to
   * computing from the incremental tree if the cache is cold.
   *
   * @param {number} eventId - The event ID to prove inclusion for.
   * @returns {Promise<{ leaf: string, proof: string[], root: string, index: number, cached: boolean }|null>}
   */
  async serveProof(eventId) {
    const leafInfo = await this.getLeafByEventId(eventId);
    if (!leafInfo) return null;

    const root = await this.getRoot();
    if (!root) return null;

    // Check cache first
    const cached = await this.deps.queryGet(
      "SELECT proof_json FROM merkle_proof_cache WHERE tree_id = ? AND leaf_index = ? AND root_hash = ?",
      [this.treeId, leafInfo.leafIndex, root],
    );

    if (cached) {
      return {
        leaf: leafInfo.leafHash,
        proof: JSON.parse(cached.proof_json),
        root,
        index: leafInfo.leafIndex,
        cached: true,
      };
    }

    // Compute proof from incremental tree
    const proof = await this.getProof(leafInfo.leafIndex);

    // Cache the proof
    await this.deps.queryRun(
      `INSERT INTO merkle_proof_cache (tree_id, leaf_index, proof_json, root_hash, cached_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (tree_id, leaf_index) DO UPDATE SET
         proof_json = excluded.proof_json,
         root_hash = excluded.root_hash,
         cached_at = CURRENT_TIMESTAMP`,
      [this.treeId, leafInfo.leafIndex, JSON.stringify(proof), root],
    );

    return {
      leaf: leafInfo.leafHash,
      proof,
      root,
      index: leafInfo.leafIndex,
      cached: false,
    };
  }

  /**
   * Bulk-build the tree from an array of events. For initial population or
   * migration from the legacy full-rebuild approach.
   *
   * @param {object[]} events - Ordered event records.
   * @returns {Promise<{ root: string, leafCount: number }>}
   */
  async bulkBuild(events) {
    if (!events || events.length === 0) {
      return { root: null, leafCount: 0 };
    }

    for (const event of events) {
      await this.appendLeaf(event);
    }

    const root = await this.getRoot();
    return { root, leafCount: events.length };
  }
}

module.exports = {
  IncrementalMerkleTree,
  ensureIncrementalSchema,
  CREATE_TREE_NODES_SQL,
  CREATE_LEAF_MAP_SQL,
  CREATE_PROOF_CACHE_SQL,
  sha256,
  hashPair,
};

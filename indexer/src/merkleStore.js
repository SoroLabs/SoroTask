"use strict";

/**
 * Persistence + request helpers for per-ledger Merkle roots (issue #863).
 *
 * The indexer stores parsed events in the SQLite `events` table (see
 * indexer/src/index.js). For each ledger sequence we build a Merkle tree over
 * that ledger's event records and persist the root hash in a `merkle_roots`
 * table keyed by ledger_sequence, so the root can be published / anchored and
 * later inclusion proofs can be verified against it.
 *
 * The dependencies (queryAll/queryGet/queryRun) are injected so this module is
 * trivially testable against an in-memory SQLite database.
 */

const { buildEventTree, hashEvent, getProof } = require("./merkle");
const {
  IncrementalMerkleTree,
  ensureIncrementalSchema,
} = require("./incrementalMerkle");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS merkle_roots (
    ledger_sequence INTEGER PRIMARY KEY,
    root TEXT NOT NULL,
    leaf_count INTEGER NOT NULL,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

async function ensureSchema(deps) {
  await deps.queryRun(CREATE_TABLE_SQL);
  await ensureIncrementalSchema(deps);
}

/**
 * Load the ordered event records for a ledger. Ordering by `id` (insertion
 * order) makes leaf ordering deterministic.
 */
async function getLedgerEvents({ queryAll }, ledger) {
  return queryAll(
    "SELECT id, ledger_sequence, contract_id, event_name, task_id, data_json FROM events WHERE ledger_sequence = ? ORDER BY id ASC",
    [ledger],
  );
}

/**
 * Compute the Merkle tree for a ledger's events and persist the root.
 * Uses the incremental Merkle tree for O(log N) updates and cached proofs.
 * @returns {Promise<{ledger:number, root:string|null, leafCount:number}>}
 */
async function computeAndStoreLedgerMerkle(deps, ledger) {
  await ensureSchema(deps);
  const events = await getLedgerEvents(deps, ledger);

  const treeId = `ledger:${ledger}`;
  const incrementalTree = new IncrementalMerkleTree(deps, treeId);

  // Check if this ledger already has an incremental tree with the correct count
  const existingCount = await incrementalTree.getLeafCount();
  if (existingCount < events.length) {
    // Append only the new leaves (incremental update)
    for (let i = existingCount; i < events.length; i++) {
      await incrementalTree.appendLeaf(events[i]);
    }
  }

  const root = await incrementalTree.getRoot();
  if (root) {
    await deps.queryRun(
      `INSERT INTO merkle_roots (ledger_sequence, root, leaf_count, computed_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(ledger_sequence) DO UPDATE SET
         root = excluded.root,
         leaf_count = excluded.leaf_count,
         computed_at = CURRENT_TIMESTAMP`,
      [ledger, root, events.length],
    );
  }
  return { ledger, root, leafCount: events.length };
}

async function getStoredRoot({ queryGet }, ledger) {
  return queryGet(
    "SELECT ledger_sequence, root, leaf_count, computed_at FROM merkle_roots WHERE ledger_sequence = ?",
    [ledger],
  );
}

/**
 * Build the response payload for GET /events/:ledger/merkle-proof.
 *
 * Uses the incremental Merkle tree for cached O(log N) proof generation,
 * targeting <5ms latency for inclusion proofs on 100,000+ indexed tasks.
 *
 * Response shape:
 *  - Without ?eventId: returns the ledger's full leaf set + root (and stored
 *    root, if any) so a caller can reconstruct/verify the whole tree.
 *  - With ?eventId=<events.id>: returns an inclusion proof for that single
 *    event leaf: { leaf, proof: [...siblingHashes], root, index, cached }.
 *
 * @returns {Promise<{status:number, body:object}>}
 */
async function buildMerkleProofResponse(deps, ledger, eventId) {
  const events = await getLedgerEvents(deps, ledger);
  if (events.length === 0) {
    return {
      status: 404,
      body: { error: `No events indexed for ledger ${ledger}` },
    };
  }

  const treeId = `ledger:${ledger}`;
  const incrementalTree = new IncrementalMerkleTree(deps, treeId);
  const stored = await getStoredRoot(deps, ledger);

  if (eventId === undefined || eventId === null || eventId === "") {
    // Full tree response — use legacy build for leaf listing
    const tree = buildEventTree(events);
    return {
      status: 200,
      body: {
        ledger_sequence: ledger,
        root: tree.root,
        storedRoot: stored ? stored.root : null,
        leafCount: events.length,
        leaves: events.map((event) => ({ id: event.id, leaf: hashEvent(event) })),
      },
    };
  }

  const targetId = Number(eventId);
  const targetEvent = events.find((event) => Number(event.id) === targetId);
  if (!targetEvent) {
    return {
      status: 404,
      body: { error: `Event ${eventId} not found in ledger ${ledger}` },
    };
  }

  // Try incremental tree proof first (cached, <5ms target)
  const proofResult = await incrementalTree.serveProof(targetId);
  if (proofResult) {
    return {
      status: 200,
      body: {
        ledger_sequence: ledger,
        eventId: targetId,
        index: proofResult.index,
        leaf: proofResult.leaf,
        proof: proofResult.proof,
        root: proofResult.root,
        storedRoot: stored ? stored.root : null,
        cached: proofResult.cached,
      },
    };
  }

  // Fallback: if incremental tree not populated, rebuild from events
  const tree = buildEventTree(events);
  const index = events.findIndex((event) => Number(event.id) === targetId);
  const leaf = hashEvent(events[index]);
  const proof = getProof(tree, index);
  return {
    status: 200,
    body: {
      ledger_sequence: ledger,
      eventId: targetId,
      index,
      leaf,
      proof,
      root: tree.root,
      storedRoot: stored ? stored.root : null,
      cached: false,
    },
  };
}

module.exports = {
  CREATE_TABLE_SQL,
  ensureSchema,
  getLedgerEvents,
  computeAndStoreLedgerMerkle,
  getStoredRoot,
  buildMerkleProofResponse,
};

"use strict";

/**
 * Cryptographic Merkle tree over a ledger's indexed event records (issue #863).
 *
 * This is a minimal, dependency-free, sorted-pair SHA-256 Merkle tree. We only
 * build tree construction / proof logic on top of Node's built-in
 * `crypto.createHash('sha256')` -- no crypto primitives are reinvented here.
 *
 * Sorted-pair hashing (each internal node hashes the two children in ascending
 * byte order, `sha256(min(a,b) || max(a,b))`) is used so that inclusion proofs
 * are position-independent: a verifier does not need to know whether each
 * sibling was a left or right child. This matches the `sortPairs` option of the
 * popular `merkletreejs` library.
 */

const crypto = require("crypto");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

/**
 * Canonically serialize an event record into a stable string so that the same
 * logical event always hashes to the same leaf regardless of key ordering.
 * @param {object} event
 * @returns {string}
 */
function canonicalizeEvent(event) {
  return JSON.stringify({
    ledger_sequence: event.ledger_sequence,
    contract_id: event.contract_id,
    event_name: event.event_name,
    task_id: event.task_id,
    data_json: event.data_json,
  });
}

/**
 * Hash a single event record into its leaf (hex-encoded).
 * @param {object} event
 * @returns {string} hex digest
 */
function hashEvent(event) {
  return sha256(Buffer.from(canonicalizeEvent(event), "utf8")).toString("hex");
}

/**
 * Combine two hex node hashes into their parent using sorted-pair hashing.
 * @param {string} a hex
 * @param {string} b hex
 * @returns {string} hex
 */
function hashPair(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  const [lo, hi] = Buffer.compare(bufA, bufB) <= 0 ? [bufA, bufB] : [bufB, bufA];
  return sha256(Buffer.concat([lo, hi])).toString("hex");
}

/**
 * Build a Merkle tree from an ordered list of leaf hashes (hex).
 * Returns the layers (layer[0] === leaves) and the root.
 * For an odd node count at a layer, the last node is promoted (duplicated up).
 * @param {string[]} leaves hex leaf hashes
 * @returns {{ layers: string[][], root: string|null, leaves: string[] }}
 */
function buildTreeFromLeaves(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    return { layers: [[]], root: null, leaves: [] };
  }
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        // Odd one out: promote unchanged.
        next.push(current[i]);
      }
    }
    layers.push(next);
  }
  return { layers, root: layers[layers.length - 1][0], leaves: layers[0] };
}

/**
 * Build a Merkle tree from an ordered list of event records.
 * @param {object[]} events
 * @returns {{ layers: string[][], root: string|null, leaves: string[] }}
 */
function buildEventTree(events) {
  return buildTreeFromLeaves((events || []).map(hashEvent));
}

/**
 * Produce an inclusion proof (ordered list of sibling hex hashes) for the leaf
 * at `index` within a built tree.
 * @param {{ layers: string[][] }} tree
 * @param {number} index leaf index in layer 0
 * @returns {string[]} sibling hashes from leaf level upward
 */
function getProof(tree, index) {
  const proof = [];
  let idx = index;
  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const nodes = tree.layers[layer];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) {
      proof.push(nodes[siblingIdx]);
    }
    // If there is no sibling (odd promotion), nothing is added for this layer.
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Verify that `leaf` combined with `proof` reproduces `root`.
 * @param {string} leaf hex leaf hash
 * @param {string[]} proof sibling hashes (from getProof)
 * @param {string} root hex root hash
 * @returns {boolean}
 */
function verifyProof(leaf, proof, root) {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed === root;
}

module.exports = {
  sha256,
  canonicalizeEvent,
  hashEvent,
  hashPair,
  buildTreeFromLeaves,
  buildEventTree,
  getProof,
  verifyProof,
};

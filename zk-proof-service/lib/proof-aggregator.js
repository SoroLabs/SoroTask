'use strict';

/**
 * proof-aggregator.js - recursive proof aggregation scaffolding (Issue #790).
 *
 * # What this is, and isn't
 *
 * Verifying N individual ZK proofs on-chain costs roughly N times the gas
 * of verifying one. Real aggregation (SnarkPack, Nova-style folding, or a
 * Halo2 accumulation scheme matching this service's existing prover) lets
 * many proofs collapse into a single proof/verification, at genuine gas
 * savings — but it is a specialized cryptographic construction, not
 * something to hand-roll without a proving-system-matched implementation
 * and a security review. Faking "aggregation" with something that isn't a
 * real cryptographic accumulator would be worse than not having this
 * feature at all: it would produce an aggregate proof that looks valid but
 * proves nothing.
 *
 * So this file provides the real, safe parts of the feature — a pluggable
 * backend interface, batching, and the actual gas-savings estimate — and
 * deliberately does NOT implement the aggregation math itself. See
 * `docs/proof-aggregation.md` for what's needed to finish it for real.
 *
 * `ProofAggregator.aggregate(proofs)` batches a list of already-generated
 * proofs (from `ZKProofService.generateProof`) and delegates the actual
 * combination to `options.backend.aggregate(proofs)` — no backend is
 * implemented by default, so calling `aggregate()` without one throws
 * rather than silently returning something that isn't a real aggregate
 * proof.
 */

const { createLogger } = require('./logger');

// Rough on-chain verification gas cost per individual proof, for the
// savings estimate below. Update to match your target chain's actual
// verifier contract's measured gas cost.
const DEFAULT_PER_PROOF_VERIFICATION_GAS = 250_000;
// A single aggregated proof's verification is not free — it still costs
// roughly this much regardless of how many proofs it combines.
const DEFAULT_AGGREGATE_VERIFICATION_GAS = 400_000;

class ProofAggregator {
  /**
   * @param {object} [options]
   * @param {{ aggregate: (proofs: object[]) => Promise<object> }} [options.backend]
   *   Pluggable aggregation implementation. Not provided by default - see
   *   the module doc comment above for why.
   * @param {number} [options.perProofVerificationGas]
   * @param {number} [options.aggregateVerificationGas]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.backend = options.backend || null;
    this.perProofVerificationGas = options.perProofVerificationGas ?? DEFAULT_PER_PROOF_VERIFICATION_GAS;
    this.aggregateVerificationGas = options.aggregateVerificationGas ?? DEFAULT_AGGREGATE_VERIFICATION_GAS;
    this.logger = options.logger || createLogger('proof-aggregator');
  }

  /**
   * Estimated on-chain gas saved by verifying one aggregate proof instead
   * of `proofCount` individual ones. Negative when aggregation wouldn't
   * actually be worth it yet (too few proofs to offset the aggregate
   * proof's own fixed verification cost).
   *
   * @param {number} proofCount
   * @returns {{
   *   individualGas: number,
   *   aggregateGas: number,
   *   estimatedSavings: number,
   *   worthAggregating: boolean,
   * }}
   */
  estimateGasSavings(proofCount) {
    const individualGas = this.perProofVerificationGas * proofCount;
    const aggregateGas = this.aggregateVerificationGas;
    const estimatedSavings = individualGas - aggregateGas;
    return {
      individualGas,
      aggregateGas,
      estimatedSavings,
      worthAggregating: estimatedSavings > 0,
    };
  }

  /**
   * Combine `proofs` into a single aggregate proof via the configured
   * backend.
   *
   * @param {object[]} proofs - Individual proof results, e.g. from
   *   `ZKProofService.generateProof`.
   * @returns {Promise<{ aggregateProof: object, proofCount: number, gasSavings: object }>}
   */
  async aggregate(proofs) {
    if (!Array.isArray(proofs) || proofs.length === 0) {
      throw new Error('aggregate() requires a non-empty array of proofs');
    }
    if (!this.backend) {
      throw new Error(
        'No aggregation backend configured. Real proof aggregation (SnarkPack/Nova/a ' +
        'Halo2 accumulation scheme) is a specialized cryptographic construction that ' +
        'is not implemented here — see docs/proof-aggregation.md. Provide one via ' +
        '`new ProofAggregator({ backend })` before calling aggregate().',
      );
    }

    const gasSavings = this.estimateGasSavings(proofs.length);
    this.logger.info('Aggregating proofs', { proofCount: proofs.length, ...gasSavings });

    const aggregateProof = await this.backend.aggregate(proofs);
    return { aggregateProof, proofCount: proofs.length, gasSavings };
  }
}

module.exports = {
  ProofAggregator,
  DEFAULT_PER_PROOF_VERIFICATION_GAS,
  DEFAULT_AGGREGATE_VERIFICATION_GAS,
};

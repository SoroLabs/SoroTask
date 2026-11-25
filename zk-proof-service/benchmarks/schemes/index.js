'use strict';

/**
 * Pluggable proof-scheme registry for the benchmarking matrix (#856).
 *
 * The issue asks for a comparison across Groth16, Plonk, and Halo2 at
 * 1K/10K/100K/1M constraints. Producing *real* numbers for that requires,
 * per scheme: a circuit compiler, compiled artifacts (wasm witness
 * calculator + proving key) at each constraint size, and — for Halo2 — a
 * separate Rust toolchain entirely. None of those exist in this repo
 * (there isn't a single .circom file with real constraint counts, no
 * compiled .zkey/.wasm artifacts, no Halo2 crate). Fabricating benchmark
 * numbers without them would be actively misleading for a tool whose
 * whole purpose is helping developers pick a scheme based on real data.
 *
 * So each adapter here declares `isAvailable()`, and the matrix runner
 * (scheme-matrix.bench.js) honestly records "skipped, unavailable" rather
 * than inventing numbers. Once real circuits/artifacts exist for a scheme,
 * fill in its `generateProof`/`verifyProof` and the matrix runner picks it
 * up automatically — no changes needed there.
 */

/**
 * @typedef {Object} ProofSchemeAdapter
 * @property {string} name
 * @property {() => boolean} isAvailable - Whether this scheme can actually run in the current environment.
 * @property {string} unavailableReason - Shown when isAvailable() is false.
 * @property {(constraintCount: number) => Promise<{ proof: unknown, sizeBytes: number }>} generateProof
 * @property {(proof: unknown) => Promise<boolean>} verifyProof
 */

function hasModule(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** @type {ProofSchemeAdapter} */
const groth16 = {
  name: 'groth16',
  isAvailable: () => false,
  unavailableReason:
    hasModule('snarkjs')
      ? 'snarkjs is installed, but no compiled circuit artifacts (.wasm/.zkey) exist at any of the ' +
        'benchmark constraint sizes. Compile circuits per size and point generateProof at them.'
      : 'snarkjs is not installed (npm install snarkjs) and no compiled circuit artifacts exist.',
  async generateProof() {
    throw new Error('[benchmarks] groth16 adapter is not wired to real circuit artifacts yet.');
  },
  async verifyProof() {
    throw new Error('[benchmarks] groth16 adapter is not wired to real circuit artifacts yet.');
  },
};

/** @type {ProofSchemeAdapter} */
const plonk = {
  name: 'plonk',
  isAvailable: () => false,
  unavailableReason:
    hasModule('snarkjs')
      ? 'snarkjs is installed, but no compiled PLONK circuit artifacts exist at any of the ' +
        'benchmark constraint sizes.'
      : 'snarkjs is not installed (npm install snarkjs) and no compiled circuit artifacts exist.',
  async generateProof() {
    throw new Error('[benchmarks] plonk adapter is not wired to real circuit artifacts yet.');
  },
  async verifyProof() {
    throw new Error('[benchmarks] plonk adapter is not wired to real circuit artifacts yet.');
  },
};

/** @type {ProofSchemeAdapter} */
const halo2 = {
  name: 'halo2',
  isAvailable: () => false,
  unavailableReason:
    'Halo2 needs a separate Rust crate (no circom/snarkjs equivalent — this repo has no Halo2 ' +
    'circuit crate at all). Add one under contract/ or a new halo2-circuits/ workspace member, ' +
    'built as a CLI or native addon this adapter can shell out to / require.',
  async generateProof() {
    throw new Error('[benchmarks] halo2 adapter has no backing Rust crate yet.');
  },
  async verifyProof() {
    throw new Error('[benchmarks] halo2 adapter has no backing Rust crate yet.');
  },
};

const SCHEMES = [groth16, plonk, halo2];

module.exports = { SCHEMES, groth16, plonk, halo2 };

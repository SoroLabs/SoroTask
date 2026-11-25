/**
 * halo2-adapter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Halo2 proof-generation / verification GATEWAY (adapter layer).
 *
 * ⚠️  HONESTY NOTICE — READ THIS BEFORE ASSUMING THIS DOES CRYPTOGRAPHY  ⚠️
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is a MOCK / REFERENCE backend. It does NOT perform any real
 * halo2 zero-knowledge proving or verification. There is intentionally NO
 * actual cryptography here — no polynomial commitments are computed, no
 * constraint system is proven, and a "valid" verification result asserts
 * nothing about the soundness of the input.
 *
 * WHY IT IS A MOCK:
 *   halo2 is a Rust ecosystem (halo2_proofs / halo2curves / PSE fork). There is
 *   no viable pure-JS or prebuilt WASM npm package that lets a Node.js/Express
 *   service perform real halo2 proving without a Rust/WASM build step. This
 *   environment cannot compile Rust (documented linker constraint), so a real
 *   prover cannot be built or verified here.
 *
 * WHAT A PRODUCTION IMPLEMENTATION WOULD REQUIRE:
 *   1. A Rust crate wrapping halo2_proofs, exposing prove()/verify() entry
 *      points, compiled to WASM via wasm-pack (or to a native addon via napi-rs).
 *   2. The circuit itself expressed as a halo2 `Circuit` impl (not .circom).
 *   3. Scheme-specific setup: KZG needs a trusted-setup SRS (e.g. from the
 *      Perpetual Powers of Tau / KZG ceremony); IPA (Inner Product Argument)
 *      needs NO trusted setup — this is the "universal circuit setup" appeal of
 *      halo2 and is why the `scheme` field is a first-class, validated input.
 *   4. The compiled artifact loaded here and injected as the adapter backend,
 *      replacing MockHalo2Backend — the route/validation/contract code below
 *      would NOT need to change (that is the point of the adapter seam).
 *
 * WHAT IS ACTUALLY REAL IN THIS FILE:
 *   - The API contract / request+response shape validation.
 *   - Commitment-scheme validation: `scheme` MUST be 'kzg' or 'ipa'.
 *   - Circuit-input structural validation (rejects malformed inputs).
 *   - The injectable-backend seam so a real prover can drop in later.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const crypto = require('crypto');

/** The only commitment schemes halo2 supports in this gateway. */
const SUPPORTED_SCHEMES = Object.freeze(['kzg', 'ipa']);

/**
 * Validate a requested commitment scheme.
 * @param {string} scheme
 * @returns {{ ok: true, scheme: string } | { ok: false, message: string }}
 */
function validateScheme(scheme) {
  if (typeof scheme !== 'string' || scheme.length === 0) {
    return { ok: false, message: 'scheme is required (expected one of: kzg, ipa)' };
  }
  const normalized = scheme.toLowerCase();
  if (!SUPPORTED_SCHEMES.includes(normalized)) {
    return {
      ok: false,
      message:
        `Unsupported commitment scheme '${scheme}'. ` +
        `halo2 gateway accepts only: ${SUPPORTED_SCHEMES.join(', ')}.`,
    };
  }
  return { ok: true, scheme: normalized };
}

/**
 * Validate the structural shape of a circuit input (the witness/advice values a
 * halo2 circuit would be assigned). We require a non-empty plain object whose
 * values are all numbers or decimal/hex strings — anything else (arrays,
 * nested objects, booleans, null values) is rejected as malformed.
 *
 * @param {unknown} circuitInput
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateCircuitInput(circuitInput) {
  if (
    circuitInput == null ||
    typeof circuitInput !== 'object' ||
    Array.isArray(circuitInput)
  ) {
    return { ok: false, message: 'circuitInput must be a non-empty object of field assignments' };
  }
  const keys = Object.keys(circuitInput);
  if (keys.length === 0) {
    return { ok: false, message: 'circuitInput must contain at least one signal assignment' };
  }
  for (const key of keys) {
    const value = circuitInput[key];
    const isNumber = typeof value === 'number' && Number.isFinite(value);
    const isFieldString =
      typeof value === 'string' && /^(0x[0-9a-fA-F]+|-?\d+)$/.test(value);
    if (!isNumber && !isFieldString) {
      return {
        ok: false,
        message:
          `circuitInput.${key} is malformed — each signal must be a finite ` +
          'number or a decimal/hex field-element string.',
      };
    }
  }
  return { ok: true };
}

/**
 * MOCK / REFERENCE halo2 backend.
 *
 * Produces a structurally-valid, explicitly-mock proof object. Every proof it
 * emits carries `isMock: true` and `backend: 'mock-reference'` so no downstream
 * consumer can mistake it for a real halo2 proof. `verify()` re-checks the
 * structural envelope and the scheme — it deliberately does NOT (and cannot)
 * verify any cryptographic soundness.
 */
class MockHalo2Backend {
  constructor() {
    this.name = 'mock-reference';
    this.isMock = true;
  }

  /**
   * @param {{ scheme: string, circuitId: string, circuitInput: object }} args
   * @returns {{ proofId: string, scheme: string, isMock: true, backend: string,
   *   commitment: string, transcript: string, publicInputs: string[] }}
   */
  prove({ scheme, circuitId, circuitInput }) {
    // Derive a deterministic-looking but cryptographically-MEANINGLESS
    // "commitment" purely so the response has a stable, testable shape.
    const digest = crypto
      .createHash('sha256')
      .update(JSON.stringify({ scheme, circuitId, circuitInput }))
      .digest('hex');

    return {
      proofId: crypto.randomUUID(),
      scheme,
      isMock: true,
      backend: this.name,
      // NOTE: not a real KZG/IPA commitment — a hash placeholder only.
      commitment: `0x${digest}`,
      transcript: `0x${crypto.randomBytes(32).toString('hex')}`,
      publicInputs: Object.keys(circuitInput).map(
        (k) => `0x${crypto.createHash('sha256').update(k).digest('hex').slice(0, 16)}`,
      ),
    };
  }

  /**
   * Structural verification only. Returns { valid, reason }.
   * @param {{ scheme: string, proof: object }} args
   */
  verify({ scheme, proof }) {
    if (!proof || typeof proof !== 'object') {
      return { valid: false, reason: 'proof is missing or not an object' };
    }
    if (proof.scheme !== scheme) {
      return {
        valid: false,
        reason: `proof.scheme '${proof.scheme}' does not match requested scheme '${scheme}'`,
      };
    }
    const hasEnvelope =
      typeof proof.commitment === 'string' &&
      typeof proof.transcript === 'string' &&
      Array.isArray(proof.publicInputs);
    if (!hasEnvelope) {
      return { valid: false, reason: 'proof envelope is structurally invalid' };
    }
    // Structurally OK. This says NOTHING about ZK soundness — mock only.
    return { valid: true, reason: null };
  }
}

/**
 * Adapter/gateway the routes call through. Holds an injectable backend so a
 * real Rust/WASM halo2 prover can replace MockHalo2Backend without touching
 * the Express layer.
 */
class Halo2ProverAdapter {
  /**
   * @param {{ backend?: { prove: Function, verify: Function, isMock?: boolean, name?: string } }} [opts]
   */
  constructor(opts = {}) {
    this.backend = opts.backend ?? new MockHalo2Backend();
  }

  /** @returns {boolean} whether the active backend is a non-crypto mock. */
  isMockBackend() {
    return this.backend.isMock === true;
  }

  /**
   * Validate + generate. Throws Error with `.code` for the route to map.
   * @param {{ scheme: string, circuitId: string, circuitInput: object }} req
   */
  generateProof({ scheme, circuitId, circuitInput }) {
    const schemeCheck = validateScheme(scheme);
    if (!schemeCheck.ok) {
      const err = new Error(schemeCheck.message);
      err.code = 'INVALID_SCHEME';
      throw err;
    }
    const inputCheck = validateCircuitInput(circuitInput);
    if (!inputCheck.ok) {
      const err = new Error(inputCheck.message);
      err.code = 'INVALID_CIRCUIT_INPUT';
      throw err;
    }
    return this.backend.prove({ scheme: schemeCheck.scheme, circuitId, circuitInput });
  }

  /**
   * Validate + verify. Throws Error with `.code` for the route to map.
   * @param {{ scheme: string, proof: object }} req
   */
  verifyProof({ scheme, proof }) {
    const schemeCheck = validateScheme(scheme);
    if (!schemeCheck.ok) {
      const err = new Error(schemeCheck.message);
      err.code = 'INVALID_SCHEME';
      throw err;
    }
    return this.backend.verify({ scheme: schemeCheck.scheme, proof });
  }
}

module.exports = {
  Halo2ProverAdapter,
  MockHalo2Backend,
  validateScheme,
  validateCircuitInput,
  SUPPORTED_SCHEMES,
};

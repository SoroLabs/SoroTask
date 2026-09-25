import type { ZkProofPayload } from "./types";

/**
 * Groth16 proof serialisation for Soroban (Issue #1250).
 *
 * snarkjs emits field elements as decimal strings in a nested JSON structure.
 * A Soroban verifier contract takes fixed-width big-endian bytes. Nothing in
 * the pipeline bridged those two representations, so a proof generated in the
 * browser could not actually be submitted.
 *
 * # Why the third coordinate is dropped
 *
 * snarkjs returns points in projective form, but always normalised — the third
 * coordinate is 1 for `pi_a` and `pi_c`, and [1, 0] for `pi_b`. The on-chain
 * pairing check takes affine points, so the z coordinate is verified to be the
 * identity and discarded rather than serialised. A non-normalised point is
 * rejected rather than silently truncated, because dividing through on the
 * client would move a correctness-critical step off the path the contract
 * checks.
 *
 * # Why G2 coordinates are reversed
 *
 * snarkjs writes each G2 coordinate as `[c0, c1]` for the field element
 * `c0 + c1 * u`. The pairing implementations Soroban verifiers are generated
 * against read the same element big-endian as `c1 || c0`. Getting this
 * backwards produces a proof that serialises cleanly and fails verification on
 * chain with no diagnostic, which is the worst possible failure mode — so the
 * order is asserted by a test rather than left to a comment.
 */

/** Width of one field element in bytes, for the BN254 curve snarkjs targets. */
export const FIELD_ELEMENT_BYTES = 32;

export class ProofEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofEncodingError";
  }
}

/**
 * Convert one decimal field-element string to fixed-width big-endian bytes.
 *
 * Rejects rather than truncates an element that does not fit: a silently
 * truncated field element produces a proof that is structurally valid and
 * cryptographically meaningless.
 */
export function fieldElementToBytes(
  value: string,
  widthBytes: number = FIELD_ELEMENT_BYTES,
): Uint8Array {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ProofEncodingError(
      `field element must be a decimal string, received "${value}"`,
    );
  }

  let big: bigint;
  try {
    big = BigInt(trimmed);
  } catch {
    throw new ProofEncodingError(`field element "${value}" is not a valid integer`);
  }

  if (big < 0n) {
    throw new ProofEncodingError("field element must not be negative");
  }

  const out = new Uint8Array(widthBytes);
  let remaining = big;
  for (let i = widthBytes - 1; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  if (remaining !== 0n) {
    throw new ProofEncodingError(
      `field element "${value}" does not fit in ${widthBytes} bytes`,
    );
  }

  return out;
}

function assertNormalised(coordinate: string, point: string): void {
  if (coordinate.trim() !== "1") {
    throw new ProofEncodingError(
      `${point} is not in normalised projective form (z = ${coordinate}); ` +
        `refusing to serialise a point the contract's pairing check would reject`,
    );
  }
}

/** Serialise a G1 point `[x, y, z]` to 64 bytes of affine `x || y`. */
export function encodeG1(point: string[], label: string): Uint8Array {
  if (point.length < 2) {
    throw new ProofEncodingError(`${label} must have at least x and y coordinates`);
  }
  if (point.length >= 3) {
    assertNormalised(point[2], label);
  }

  const out = new Uint8Array(FIELD_ELEMENT_BYTES * 2);
  out.set(fieldElementToBytes(point[0]), 0);
  out.set(fieldElementToBytes(point[1]), FIELD_ELEMENT_BYTES);
  return out;
}

/**
 * Serialise a G2 point `[[x0, x1], [y0, y1], [z0, z1]]` to 128 bytes.
 *
 * Each coordinate is written `c1 || c0` — see the note at the top of the file.
 */
export function encodeG2(point: string[][], label: string): Uint8Array {
  if (point.length < 2) {
    throw new ProofEncodingError(`${label} must have at least x and y coordinates`);
  }
  if (point.length >= 3) {
    const z = point[2];
    if (z.length < 2 || z[0].trim() !== "1" || z[1].trim() !== "0") {
      throw new ProofEncodingError(
        `${label} is not in normalised projective form (z = [${z.join(", ")}])`,
      );
    }
  }

  const [x, y] = point;
  if (x.length < 2 || y.length < 2) {
    throw new ProofEncodingError(`${label} coordinates must each have two components`);
  }

  const out = new Uint8Array(FIELD_ELEMENT_BYTES * 4);
  out.set(fieldElementToBytes(x[1]), 0);
  out.set(fieldElementToBytes(x[0]), FIELD_ELEMENT_BYTES);
  out.set(fieldElementToBytes(y[1]), FIELD_ELEMENT_BYTES * 2);
  out.set(fieldElementToBytes(y[0]), FIELD_ELEMENT_BYTES * 3);
  return out;
}

export interface SorobanProofBytes {
  /** 256 bytes: pi_a (64) || pi_b (128) || pi_c (64). */
  proof: Uint8Array;
  /** Public signals, 32 bytes each, in circuit order. */
  publicSignals: Uint8Array;
  /** Hex form, for logging and for CLI submission. */
  proofHex: string;
  publicSignalsHex: string;
}

export function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Encode a generated proof into the byte layout a Soroban verifier expects.
 *
 * The concatenation order — a, b, c — matches the argument order of the
 * generated verifier entry point. It is fixed by the circuit's verifier, not
 * chosen here.
 */
export function encodeProofForSoroban(payload: ZkProofPayload): SorobanProofBytes {
  if (payload.status !== "success") {
    throw new ProofEncodingError("cannot encode a proof that did not generate successfully");
  }

  const a = encodeG1(payload.pi_a, "pi_a");
  const b = encodeG2(payload.pi_b, "pi_b");
  const c = encodeG1(payload.pi_c, "pi_c");

  const proof = new Uint8Array(a.length + b.length + c.length);
  proof.set(a, 0);
  proof.set(b, a.length);
  proof.set(c, a.length + b.length);

  const publicSignals = new Uint8Array(payload.publicSignals.length * FIELD_ELEMENT_BYTES);
  payload.publicSignals.forEach((signal, index) => {
    publicSignals.set(fieldElementToBytes(signal), index * FIELD_ELEMENT_BYTES);
  });

  return {
    proof,
    publicSignals,
    proofHex: toHex(proof),
    publicSignalsHex: toHex(publicSignals),
  };
}

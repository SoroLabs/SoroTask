import {
  encodeG1,
  encodeG2,
  encodeProofForSoroban,
  FIELD_ELEMENT_BYTES,
  fieldElementToBytes,
  ProofEncodingError,
  toHex,
} from "../soroban-encoding";
import type { ZkProofPayload } from "../types";

/**
 * Groth16 serialisation for Soroban (Issue #1250).
 *
 * Every failure mode here produces bytes that look fine and fail verification
 * on chain with no diagnostic, so the tests assert exact layouts rather than
 * shapes.
 */

function payload(overrides: Partial<ZkProofPayload> = {}): ZkProofPayload {
  return {
    proofId: "p-1",
    status: "success",
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
      ["1", "0"],
    ],
    pi_c: ["7", "8", "1"],
    publicSignals: ["9"],
    ...overrides,
  };
}

describe("fieldElementToBytes", () => {
  it("writes big-endian, zero-padded to the field width", () => {
    const bytes = fieldElementToBytes("1");
    expect(bytes).toHaveLength(FIELD_ELEMENT_BYTES);
    expect(bytes[FIELD_ELEMENT_BYTES - 1]).toBe(1);
    expect(bytes[0]).toBe(0);
  });

  it("encodes a multi-byte value in the right order", () => {
    const bytes = fieldElementToBytes("258");
    expect(bytes[FIELD_ELEMENT_BYTES - 1]).toBe(2);
    expect(bytes[FIELD_ELEMENT_BYTES - 2]).toBe(1);
  });

  it("rejects an element too wide for the field", () => {
    // A silently truncated field element produces a proof that is
    // structurally valid and cryptographically meaningless.
    const tooBig = (1n << 256n).toString();
    expect(() => fieldElementToBytes(tooBig)).toThrow(ProofEncodingError);
  });

  it("rejects non-decimal and negative input", () => {
    expect(() => fieldElementToBytes("0x10")).toThrow(ProofEncodingError);
    expect(() => fieldElementToBytes("-1")).toThrow(ProofEncodingError);
    expect(() => fieldElementToBytes("")).toThrow(ProofEncodingError);
  });

  it("accepts the largest value that fits", () => {
    const max = ((1n << 256n) - 1n).toString();
    expect(fieldElementToBytes(max).every((b) => b === 0xff)).toBe(true);
  });
});

describe("encodeG1", () => {
  it("writes x then y as 64 bytes", () => {
    const bytes = encodeG1(["1", "2", "1"], "pi_a");
    expect(bytes).toHaveLength(64);
    expect(bytes[31]).toBe(1);
    expect(bytes[63]).toBe(2);
  });

  it("rejects a point that is not normalised", () => {
    // Dividing through on the client would move a correctness-critical step
    // off the path the contract checks.
    expect(() => encodeG1(["1", "2", "3"], "pi_a")).toThrow(/normalised/);
  });

  it("rejects a point missing a coordinate", () => {
    expect(() => encodeG1(["1"], "pi_a")).toThrow(ProofEncodingError);
  });
});

describe("encodeG2", () => {
  it("writes each coordinate as c1 then c0", () => {
    // snarkjs emits [c0, c1] for c0 + c1*u; the on-chain pairing reads
    // c1 || c0. Reversing this yields a proof that serialises cleanly and
    // fails verification with no diagnostic.
    const bytes = encodeG2(
      [
        ["3", "4"],
        ["5", "6"],
        ["1", "0"],
      ],
      "pi_b",
    );

    expect(bytes).toHaveLength(128);
    expect(bytes[31]).toBe(4);
    expect(bytes[63]).toBe(3);
    expect(bytes[95]).toBe(6);
    expect(bytes[127]).toBe(5);
  });

  it("rejects a non-normalised G2 point", () => {
    expect(() =>
      encodeG2(
        [
          ["3", "4"],
          ["5", "6"],
          ["2", "0"],
        ],
        "pi_b",
      ),
    ).toThrow(/normalised/);
  });

  it("rejects a coordinate with a missing component", () => {
    expect(() => encodeG2([["3"], ["5", "6"]], "pi_b")).toThrow(ProofEncodingError);
  });
});

describe("encodeProofForSoroban", () => {
  it("concatenates a, b, c into 256 bytes", () => {
    const encoded = encodeProofForSoroban(payload());
    expect(encoded.proof).toHaveLength(64 + 128 + 64);
  });

  it("preserves the a, b, c order the verifier expects", () => {
    const encoded = encodeProofForSoroban(payload());
    expect(encoded.proof[31]).toBe(1);
    expect(encoded.proof[63]).toBe(2);
    expect(encoded.proof[64 + 31]).toBe(4);
    expect(encoded.proof[64 + 128 + 31]).toBe(7);
  });

  it("encodes public signals in circuit order, 32 bytes each", () => {
    const encoded = encodeProofForSoroban(
      payload({ publicSignals: ["1", "2", "3"] }),
    );
    expect(encoded.publicSignals).toHaveLength(96);
    expect(encoded.publicSignals[31]).toBe(1);
    expect(encoded.publicSignals[63]).toBe(2);
    expect(encoded.publicSignals[95]).toBe(3);
  });

  it("handles a circuit with no public signals", () => {
    const encoded = encodeProofForSoroban(payload({ publicSignals: [] }));
    expect(encoded.publicSignals).toHaveLength(0);
    expect(encoded.publicSignalsHex).toBe("0x");
  });

  it("refuses to encode a failed proof", () => {
    expect(() => encodeProofForSoroban(payload({ status: "failed" }))).toThrow(
      ProofEncodingError,
    );
  });

  it("produces hex matching the bytes", () => {
    const encoded = encodeProofForSoroban(payload());
    expect(encoded.proofHex.startsWith("0x")).toBe(true);
    expect(encoded.proofHex).toHaveLength(2 + 256 * 2);
    expect(encoded.proofHex).toBe(toHex(encoded.proof));
  });
});

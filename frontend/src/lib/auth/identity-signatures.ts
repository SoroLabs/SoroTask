import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { createHash } from "node:crypto";

export function isStellarIdentityAddress(address: unknown): address is string {
  return typeof address === "string" && StrKey.isValidEd25519PublicKey(address);
}

export function verifyStellarIdentitySignature(address: string, message: string, signature: string): boolean {
  if (!isStellarIdentityAddress(address) || !/^[A-Za-z0-9+/]{86}={0,2}$/.test(signature)) return false;
  try {
    const bytes = Buffer.from(signature, "base64");
    const payload = createHash("sha256").update("Stellar Signed Message:\n", "utf8").update(message, "utf8").digest();
    return bytes.length === 64 && Keypair.fromPublicKey(address).verify(payload, bytes);
  } catch { return false; }
}

/** Recover the EIP-191 personal_sign owner; no contract or chain transaction. */
export function verifySocialOwnerSignature(owner: string, message: string, signature: string): boolean {
  if (!/^0x[0-9a-f]{40}$/i.test(owner) || !/^0x[0-9a-f]{130}$/i.test(signature)) return false;
  try {
    const bytes = Buffer.from(signature.slice(2), "hex");
    const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
    if (recovery !== 0 && recovery !== 1) return false;
    const parsed = secp256k1.Signature.fromCompact(bytes.subarray(0, 64)).addRecoveryBit(recovery);
    if (parsed.hasHighS()) return false;
    const payload = Buffer.from(message, "utf8");
    const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${payload.length}`), payload]));
    const key = parsed.recoverPublicKey(hash).toRawBytes(false);
    const address = Buffer.from(keccak_256(key.subarray(1))).subarray(12).toString("hex");
    return `0x${address}` === owner.toLowerCase();
  } catch { return false; }
}

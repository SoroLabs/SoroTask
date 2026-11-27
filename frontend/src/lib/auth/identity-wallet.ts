import { getAddress, signMessage } from "@stellar/freighter-api";
import type { IdentityChallenge } from "./keeper-identities";

type EvmProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** Signing a link is never substituted with a funded transaction or simulated signature. */
export async function signKeeperIdentity(challenge: IdentityChallenge): Promise<string> {
  const before = await getAddress();
  if (before.error || before.address !== challenge.walletAddress) throw new Error("Select the same keeper account in Freighter before signing.");
  const result = await signMessage(challenge.message, { address: challenge.walletAddress, networkPassphrase: challenge.networkPassphrase });
  if (result.error || !result.signedMessage) throw new Error("Wallet signature was declined or unavailable.");
  if (result.signerAddress !== challenge.walletAddress) throw new Error("The signature came from a different keeper account. Start again.");
  const after = await getAddress();
  if (after.error || after.address !== challenge.walletAddress) throw new Error("The wallet account changed. Start again with the current account.");
  const signed = result.signedMessage;
  if (typeof signed !== "string") {
    if (signed.length !== 64) throw new Error("The wallet returned an invalid signature.");
    return btoa(String.fromCharCode(...signed));
  }
  if (/^(?:0x)?[0-9a-f]{128}$/i.test(signed)) {
    const hex = signed.replace(/^0x/i, "");
    return btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16))));
  }
  if (!/^[A-Za-z0-9+/]{86}={0,2}$/.test(signed)) throw new Error("The wallet returned an invalid signature.");
  return signed;
}

export async function signSocialOwner(challenge: IdentityChallenge): Promise<string | undefined> {
  if (!challenge.ownerAddress) return undefined;
  const ethereum = (window as Window & { ethereum?: EvmProvider }).ethereum;
  if (!ethereum) throw new Error("An Ethereum-compatible wallet is needed to prove ownership of this social profile.");
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts.some((account: unknown) => typeof account === "string" && account.toLowerCase() === challenge.ownerAddress)) {
    throw new Error("Select the social profile owner account in your Ethereum wallet.");
  }
  const bytes = new TextEncoder().encode(challenge.message);
  const hex = "0x" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const signature = await ethereum.request({ method: "personal_sign", params: [hex, challenge.ownerAddress] });
  if (typeof signature !== "string") throw new Error("Social account signature was declined.");
  return signature;
}

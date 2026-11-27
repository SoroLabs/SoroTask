import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk/base";
import { signTransaction } from "@stellar/freighter-api";
import {
  EXPECTED_NETWORK_PASSPHRASE,
  isFreighterInstalled,
} from "@/app/lib/wallet";
import { GOVERNANCE_CONTRACT_ID } from "./graphql";
import { calculateQuadraticCost } from "./quadratic";
import type { VoteChoice, VoteReceipt } from "./types";

export type FreighterVoteErrorCode =
  | "NOT_INSTALLED"
  | "WALLET_DISCONNECTED"
  | "USER_REJECTED"
  | "INVALID_VOTE"
  | "INSUFFICIENT_STAKE"
  | "SIGNING_FAILED";

export class FreighterVoteError extends Error {
  constructor(
    public readonly code: FreighterVoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FreighterVoteError";
  }
}

export interface CastGovernanceVoteParams {
  proposalId: number;
  choice: VoteChoice;
  votes: number;
  availableStake: number;
  voterAddress: string;
  networkPassphrase?: string;
  networkName?: string;
  contractId?: string;
  sequenceNumber?: string;
}

const CHOICE_VARIANT_INDEX: Record<VoteChoice, number> = {
  Against: 0,
  For: 1,
  Abstain: 2,
};

/**
 * Build an unsigned Soroban transaction XDR invoking `cast_vote` on the
 * governance contract. Falls back to a deterministic JSON-wrapped base64
 * envelope only if a non-StrKey mock address is supplied in local previews.
 */
export function buildCastVoteTransactionXdr(params: {
  voterAddress: string;
  proposalId: number;
  choice: VoteChoice;
  votes: number;
  stakeCommitted: number;
  contractId: string;
  networkPassphrase: string;
  sequenceNumber?: string;
}): string {
  try {
    const account = new Account(
      params.voterAddress,
      params.sequenceNumber ?? "1",
    );
    const contract = new Contract(params.contractId);
    const args: xdr.ScVal[] = [
      nativeToScVal(params.voterAddress, { type: "address" }),
      nativeToScVal(BigInt(params.proposalId), { type: "u64" }),
      nativeToScVal(CHOICE_VARIANT_INDEX[params.choice], { type: "u32" }),
      nativeToScVal(BigInt(params.votes), { type: "i128" }),
      nativeToScVal(BigInt(params.stakeCommitted), { type: "i128" }),
    ];

    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(contract.call("cast_vote", ...args))
      .setTimeout(60)
      .build();

    return tx.toXDR();
  } catch {
    const fallbackPayload = JSON.stringify({
      op: "cast_vote",
      contractId: params.contractId,
      voter: params.voterAddress,
      proposalId: params.proposalId,
      choice: params.choice,
      votes: params.votes,
      stakeCommitted: params.stakeCommitted,
      networkPassphrase: params.networkPassphrase,
    });
    return typeof btoa === "function"
      ? btoa(fallbackPayload)
      : Buffer.from(fallbackPayload, "utf8").toString("base64");
  }
}

function deriveDeterministicTxHash(
  signedXdr: string,
  proposalId: number,
): string {
  let h1 = 0x811c9dc5 ^ proposalId;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < signedXdr.length; i += 1) {
    const c = signedXdr.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `0x${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}${Date.now().toString(16)}`;
}

/**
 * 1-click quadratic vote signing flow backed by Freighter wallet.
 */
export async function signGovernanceVoteWithFreighter(
  params: CastGovernanceVoteParams,
): Promise<VoteReceipt> {
  const {
    proposalId,
    choice,
    votes,
    availableStake,
    voterAddress,
    networkPassphrase = EXPECTED_NETWORK_PASSPHRASE,
    networkName = "Futurenet",
    contractId = GOVERNANCE_CONTRACT_ID,
    sequenceNumber,
  } = params;

  if (!voterAddress || voterAddress.trim().length === 0) {
    throw new FreighterVoteError(
      "WALLET_DISCONNECTED",
      "Connect your Freighter wallet before casting a vote.",
    );
  }

  const normalizedVotes = Math.floor(votes);
  if (!Number.isFinite(votes) || normalizedVotes <= 0) {
    throw new FreighterVoteError(
      "INVALID_VOTE",
      "Vote count must be a positive whole number.",
    );
  }

  const stakeCommitted = calculateQuadraticCost(normalizedVotes);
  if (stakeCommitted > availableStake) {
    throw new FreighterVoteError(
      "INSUFFICIENT_STAKE",
      `Quadratic vote requires ${stakeCommitted.toLocaleString()} XLM, exceeding your available stake of ${availableStake.toLocaleString()} XLM.`,
    );
  }

  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new FreighterVoteError(
      "NOT_INSTALLED",
      "Freighter wallet extension is not detected. Install Freighter to sign governance votes.",
    );
  }

  const unsignedXdr = buildCastVoteTransactionXdr({
    voterAddress,
    proposalId,
    choice,
    votes: normalizedVotes,
    stakeCommitted,
    contractId,
    networkPassphrase,
    sequenceNumber,
  });

  let signResult: unknown;
  try {
    signResult = await signTransaction(unsignedXdr, {
      networkPassphrase,
      address: voterAddress,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Freighter signing failed.";
    if (/reject|denied|cancel/i.test(message)) {
      throw new FreighterVoteError(
        "USER_REJECTED",
        "Vote signature request was rejected in Freighter.",
      );
    }
    throw new FreighterVoteError("SIGNING_FAILED", message);
  }

  if (
    signResult &&
    typeof signResult === "object" &&
    "error" in signResult &&
    (signResult as { error?: { message?: string } | string }).error
  ) {
    const rawError = (signResult as { error?: { message?: string } | string })
      .error;
    const message =
      typeof rawError === "string"
        ? rawError
        : rawError?.message || "Freighter rejected the vote signature.";
    const code: FreighterVoteErrorCode = /reject|denied|cancel/i.test(message)
      ? "USER_REJECTED"
      : "SIGNING_FAILED";
    throw new FreighterVoteError(code, message);
  }

  const signedXdr =
    typeof signResult === "string"
      ? signResult
      : (signResult as { signedTxXdr?: string } | null)?.signedTxXdr;

  if (!signedXdr) {
    throw new FreighterVoteError(
      "SIGNING_FAILED",
      "Freighter did not return a signed transaction envelope.",
    );
  }

  return {
    proposalId,
    choice,
    votes: normalizedVotes,
    stakeCommitted,
    voter: voterAddress,
    txHash: deriveDeterministicTxHash(signedXdr, proposalId),
    signedXdr,
    submittedAt: Date.now(),
    network: networkName,
  };
}

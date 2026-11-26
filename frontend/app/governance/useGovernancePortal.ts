"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletOptional } from "@/app/context/WalletContext";
import { useSubgraphSubscription } from "@/src/lib/graphql";
import type { AuditLogEntry } from "@/app/types/auditLog";
import {
  applyVoteEventToProposals,
  DEFAULT_GOVERNANCE_AUDIT_LOGS,
  DEFAULT_GOVERNANCE_PROPOSALS,
  fetchGovernanceEvents,
  getGovernanceSubgraphConfig,
  GOVERNANCE_CONTRACT_ID,
  GOVERNANCE_EVENT_SUBSCRIPTION,
  parseGovernanceVoteEvent,
  voteEventToAuditLog,
  type IndexerEventRecord,
} from "./graphql";
import { signGovernanceVoteWithFreighter } from "./freighterVote";
import {
  createVerifiedAuditEntry,
  verifyAuditEntryIntegrity,
} from "./quadratic";
import type {
  GovernanceProposal,
  GovernanceVoteEvent,
  IndexerConnectionState,
  VoteChoice,
  VoteReceipt,
} from "./types";

const DEFAULT_CONNECTED_STAKE_XLM = 2500;
const PREVIEW_DISCONNECTED_STAKE_XLM = 1000;

export interface UseGovernancePortalOptions {
  initialProposals?: GovernanceProposal[];
  initialAuditLogs?: AuditLogEntry[];
  enableLiveSubscription?: boolean;
}

export interface UseGovernancePortalResult {
  proposals: GovernanceProposal[];
  auditLogs: AuditLogEntry[];
  selectedProposalId: number;
  selectedProposal: GovernanceProposal | null;
  selectProposal: (proposalId: number) => void;
  indexerState: IndexerConnectionState;
  lastSyncedAt: number | null;
  liveEventCount: number;
  walletAddress: string | null;
  walletNetwork: string;
  isWalletConnected: boolean;
  isWalletConnecting: boolean;
  availableStake: number;
  isPreviewStake: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  isSigningVote: boolean;
  voteError: string | null;
  clearVoteError: () => void;
  receiptsByProposal: Record<number, VoteReceipt>;
  castVote: (
    proposalId: number,
    choice: VoteChoice,
    votes: number,
  ) => Promise<VoteReceipt | null>;
  verifyAuditEntry: (entryId: string) => boolean;
  refreshFromIndexer: () => Promise<void>;
}

export function useGovernancePortal(
  options: UseGovernancePortalOptions = {},
): UseGovernancePortalResult {
  const {
    initialProposals = DEFAULT_GOVERNANCE_PROPOSALS,
    initialAuditLogs = DEFAULT_GOVERNANCE_AUDIT_LOGS,
    enableLiveSubscription = true,
  } = options;

  const wallet = useWalletOptional();
  const subgraphConfig = useMemo(() => getGovernanceSubgraphConfig(), []);

  const [proposals, setProposals] =
    useState<GovernanceProposal[]>(initialProposals);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(initialAuditLogs);
  const [selectedProposalId, setSelectedProposalId] = useState<number>(
    initialProposals[0]?.proposalId ?? 0,
  );
  const [httpState, setHttpState] = useState<"idle" | "live" | "fallback">(
    "idle",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [liveEventCount, setLiveEventCount] = useState(0);
  const [isSigningVote, setIsSigningVote] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [receiptsByProposal, setReceiptsByProposal] = useState<
    Record<number, VoteReceipt>
  >({});
  const [committedStakeOffset, setCommittedStakeOffset] = useState(0);

  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const applyIncomingVoteEvents = useCallback(
    (events: GovernanceVoteEvent[]) => {
      const fresh = events.filter(
        (ev) => !seenEventIdsRef.current.has(ev.eventId),
      );
      if (fresh.length === 0) return;

      for (const ev of fresh) {
        seenEventIdsRef.current.add(ev.eventId);
      }

      setProposals((prev) =>
        fresh.reduce(
          (acc, event) => applyVoteEventToProposals(acc, event),
          prev,
        ),
      );
      setAuditLogs((prev) => [
        ...fresh.map(voteEventToAuditLog).reverse(),
        ...prev,
      ]);
      setLiveEventCount((count) => count + fresh.length);
      setLastSyncedAt(Date.now());
    },
    [],
  );

  const refreshFromIndexer = useCallback(async () => {
    const controller = new AbortController();
    try {
      const events = await fetchGovernanceEvents(
        subgraphConfig.url,
        30,
        controller.signal,
      );
      applyIncomingVoteEvents(events);
      setHttpState("live");
      setLastSyncedAt(Date.now());
    } catch {
      setHttpState("fallback");
    }
  }, [subgraphConfig.url, applyIncomingVoteEvents]);

  // Initial HTTP hydration from the GraphQL indexer
  useEffect(() => {
    if (!enableLiveSubscription) return;
    let active = true;
    const controller = new AbortController();

    fetchGovernanceEvents(subgraphConfig.url, 30, controller.signal)
      .then((events) => {
        if (!active) return;
        applyIncomingVoteEvents(events);
        setHttpState("live");
        setLastSyncedAt(Date.now());
      })
      .catch(() => {
        if (!active) return;
        setHttpState("fallback");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enableLiveSubscription, subgraphConfig.url, applyIncomingVoteEvents]);

  // Real-time GraphQL WebSocket subscription via SoroTask SubscriptionManager
  const subscriptionRequest = useMemo(
    () => ({
      query: GOVERNANCE_EVENT_SUBSCRIPTION,
      variables: { contract_id: GOVERNANCE_CONTRACT_ID },
      operationName: "GovernanceEventAdded",
    }),
    [],
  );

  const handleSubscriptionData = useCallback(
    (payload: { eventAdded?: IndexerEventRecord }) => {
      if (!payload?.eventAdded) return;
      const parsed = parseGovernanceVoteEvent(payload.eventAdded);
      if (parsed) {
        applyIncomingVoteEvents([parsed]);
      }
    },
    [applyIncomingVoteEvents],
  );

  const { status: wsStatus } = useSubgraphSubscription<{
    eventAdded?: IndexerEventRecord;
  }>({
    config: subgraphConfig,
    request: subscriptionRequest,
    onData: handleSubscriptionData,
    enabled: enableLiveSubscription && typeof WebSocket !== "undefined",
  });

  const indexerState: IndexerConnectionState = useMemo(() => {
    if (wsStatus === "connected") return "live";
    if (wsStatus === "reconnecting") return "reconnecting";
    if (wsStatus === "connecting" && httpState === "idle") return "connecting";
    if (httpState === "live") return "live";
    if (wsStatus === "error" && httpState === "fallback") return "fallback";
    return "fallback";
  }, [wsStatus, httpState]);

  // Wallet & stake calculation
  const walletAddress = wallet.session?.address ?? null;
  const isWalletConnected = Boolean(walletAddress);
  const walletNetwork = wallet.session?.network.network ?? "Futurenet";

  const baseWalletStake = useMemo(() => {
    if (!walletAddress) return PREVIEW_DISCONNECTED_STAKE_XLM;
    const matched = wallet.connectedAccounts.find(
      (acc) => acc.address === walletAddress,
    );
    if (
      matched &&
      Number.isFinite(matched.balanceXlm) &&
      matched.balanceXlm > 0
    ) {
      return matched.balanceXlm;
    }
    return DEFAULT_CONNECTED_STAKE_XLM;
  }, [walletAddress, wallet.connectedAccounts]);

  const availableStake = Math.max(
    0,
    Number((baseWalletStake - committedStakeOffset).toFixed(4)),
  );

  const selectedProposal = useMemo(
    () =>
      proposals.find((p) => p.proposalId === selectedProposalId) ??
      proposals[0] ??
      null,
    [proposals, selectedProposalId],
  );

  const selectProposal = useCallback((proposalId: number) => {
    setSelectedProposalId(proposalId);
    setVoteError(null);
  }, []);

  const clearVoteError = useCallback(() => setVoteError(null), []);

  const castVote = useCallback(
    async (
      proposalId: number,
      choice: VoteChoice,
      votes: number,
    ): Promise<VoteReceipt | null> => {
      setVoteError(null);

      if (!walletAddress) {
        setVoteError("Connect your Freighter wallet before casting a vote.");
        return null;
      }

      setIsSigningVote(true);
      try {
        const receipt = await signGovernanceVoteWithFreighter({
          proposalId,
          choice,
          votes,
          availableStake,
          voterAddress: walletAddress,
          networkPassphrase: wallet.session?.network.networkPassphrase,
          networkName: walletNetwork,
        });

        setReceiptsByProposal((prev) => ({
          ...prev,
          [proposalId]: receipt,
        }));
        setCommittedStakeOffset((prev) => prev + receipt.stakeCommitted);

        // Apply optimistic vote tally + append verified audit log entry
        const localEvent: GovernanceVoteEvent = {
          eventId: `local-${receipt.txHash}`,
          proposalId,
          voter: walletAddress,
          choice,
          votes: receipt.votes,
          stakeCost: receipt.stakeCommitted,
          ledgerSequence: (selectedProposal?.currentBlock ?? 1_489_120) + 1,
          timestamp: receipt.submittedAt,
        };
        seenEventIdsRef.current.add(localEvent.eventId);

        setProposals((prev) => applyVoteEventToProposals(prev, localEvent));
        setAuditLogs((prev) => [
          createVerifiedAuditEntry({
            id: `vote-${receipt.txHash.slice(0, 14)}`,
            timestamp: receipt.submittedAt,
            action: `governance.vote_signed [SIP-${String(proposalId).padStart(3, "0")}: +${receipt.votes} ${choice} | ${receipt.stakeCommitted} XLM]`,
            actor:
              walletAddress.length > 14
                ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`
                : walletAddress,
            severity: receipt.votes >= 25 ? "warning" : "info",
          }),
          ...prev,
        ]);

        wallet.trackTransaction({
          txHash: receipt.txHash,
          description: `Governance vote on SIP-${String(proposalId).padStart(3, "0")} (${choice}, ${receipt.votes} votes)`,
          sequenceNumber: Date.now(),
          baseFee: 10000,
          payload: { proposalId, choice, votes: receipt.votes },
        });

        setLastSyncedAt(receipt.submittedAt);
        return receipt;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to sign governance vote with Freighter.";
        setVoteError(message);
        return null;
      } finally {
        setIsSigningVote(false);
      }
    },
    [
      walletAddress,
      availableStake,
      wallet,
      walletNetwork,
      selectedProposal?.currentBlock,
    ],
  );

  // Fast O(1) lookup map for AuditLogImmutableView tamper verification
  const auditEntryMap = useMemo(() => {
    const map = new Map<string, AuditLogEntry>();
    for (const entry of auditLogs) {
      map.set(entry.id, entry);
    }
    return map;
  }, [auditLogs]);

  const verifyAuditEntry = useCallback(
    (entryId: string): boolean => {
      const entry = auditEntryMap.get(entryId);
      if (!entry) return false;
      return verifyAuditEntryIntegrity(entry);
    },
    [auditEntryMap],
  );

  return {
    proposals,
    auditLogs,
    selectedProposalId: selectedProposal?.proposalId ?? selectedProposalId,
    selectedProposal,
    selectProposal,
    indexerState,
    lastSyncedAt,
    liveEventCount,
    walletAddress,
    walletNetwork,
    isWalletConnected,
    isWalletConnecting: wallet.isLoading,
    availableStake,
    isPreviewStake: !isWalletConnected,
    connectWallet: wallet.connect,
    disconnectWallet: wallet.disconnect,
    isSigningVote,
    voteError,
    clearVoteError,
    receiptsByProposal,
    castVote,
    verifyAuditEntry,
    refreshFromIndexer,
  };
}

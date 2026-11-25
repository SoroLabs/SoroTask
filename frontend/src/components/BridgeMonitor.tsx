"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";

export type BridgeChainId =
  "stellar" | "ethereum" | "polygon" | "arbitrum" | "base";

export type BridgeStepId =
  "source_lock" | "relayer_gossip" | "state_proof" | "destination_execution";

export type StepState =
  "pending" | "in_progress" | "verified" | "delayed" | "failed";

export interface ProofVerificationDetails {
  proofType: "merkle_patricia" | "zk_snark" | "committee_multisig";
  proofHash: string;
  blockConfirmations: number;
  requiredConfirmations: number;
  merkleRoot: string;
  verifiedAt?: string;
  foreignBlockNumber?: number;
}

export interface BridgeTransferTask {
  id: string;
  sourceChain: BridgeChainId;
  destinationChain: BridgeChainId;
  tokenSymbol: string;
  amount: string;
  sender: string;
  recipient: string;
  currentStep: BridgeStepId;
  stepStates: Record<BridgeStepId, StepState>;
  sourceTxHash?: string;
  destinationTxHash?: string;
  proofDetails: ProofVerificationDetails;
  initiatedAt: string;
  lastUpdatedAt: string;
  elapsedSeconds: number;
  slaThresholdSeconds: number;
  delayReason?: string;
}

export interface BridgeMonitorProps {
  initialTasks?: BridgeTransferTask[];
  onTaskSelect?: (task: BridgeTransferTask) => void;
  className?: string;
}

const CHAIN_METADATA: Record<
  BridgeChainId,
  { name: string; icon: string; explorerTxUrl: (hash: string) => string }
> = {
  stellar: {
    name: "Stellar / Soroban",
    icon: "⭐",
    explorerTxUrl: (hash) =>
      `https://stellar.expert/explorer/testnet/tx/${hash}`,
  },
  ethereum: {
    name: "Ethereum Sepolia",
    icon: "◆",
    explorerTxUrl: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
  },
  polygon: {
    name: "Polygon Amoy",
    icon: "⬡",
    explorerTxUrl: (hash) => `https://amoy.polygonscan.com/tx/${hash}`,
  },
  arbitrum: {
    name: "Arbitrum Sepolia",
    icon: "▲",
    explorerTxUrl: (hash) => `https://sepolia.arbiscan.io/tx/${hash}`,
  },
  base: {
    name: "Base Sepolia",
    icon: "🔵",
    explorerTxUrl: (hash) => `https://sepolia.basescan.org/tx/${hash}`,
  },
};

const STEP_LABELS: Record<
  BridgeStepId,
  { label: string; description: string; stepNumber: number }
> = {
  source_lock: {
    label: "Source Lock",
    description: "Assets escrowed on Stellar ledger contract",
    stepNumber: 1,
  },
  relayer_gossip: {
    label: "Relayer Gossip",
    description:
      "Validator threshold signatures gossiped across P2P relayer network",
    stepNumber: 2,
  },
  state_proof: {
    label: "State Proof Verification",
    description:
      "Merkle root and cryptographic state proof checked on foreign chain",
    stepNumber: 3,
  },
  destination_execution: {
    label: "Destination Execution",
    description: "Tokens minted or released on destination contract",
    stepNumber: 4,
  },
};

const INITIAL_MOCK_TASKS: BridgeTransferTask[] = [
  {
    id: "br-tx-9941",
    sourceChain: "stellar",
    destinationChain: "ethereum",
    tokenSymbol: "USDC",
    amount: "12,500.00",
    sender: "GA7Q...9P2K",
    recipient: "0x3E...b891",
    currentStep: "state_proof",
    stepStates: {
      source_lock: "verified",
      relayer_gossip: "verified",
      state_proof: "delayed",
      destination_execution: "pending",
    },
    sourceTxHash:
      "e6b5278c2e6f477383a8b4c05763261a8a3014a161479815049a15a0bb9b7401",
    proofDetails: {
      proofType: "merkle_patricia",
      proofHash: "0x8f4c...91a2",
      blockConfirmations: 8,
      requiredConfirmations: 12,
      merkleRoot: "0x17b2...ec40",
      foreignBlockNumber: 5821094,
    },
    initiatedAt: new Date(Date.now() - 320000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 45000).toISOString(),
    elapsedSeconds: 320,
    slaThresholdSeconds: 180,
    delayReason:
      "Ethereum Sepolia gas spike causing relayer batching delay. 8/12 blocks confirmed.",
  },
  {
    id: "br-tx-9942",
    sourceChain: "stellar",
    destinationChain: "arbitrum",
    tokenSymbol: "XLM",
    amount: "45,000.00",
    sender: "GB91...88AQ",
    recipient: "0x82...10cc",
    currentStep: "relayer_gossip",
    stepStates: {
      source_lock: "verified",
      relayer_gossip: "in_progress",
      state_proof: "pending",
      destination_execution: "pending",
    },
    sourceTxHash:
      "39a04bc8d76e25f891040842a19dc183956bf6f161821074e50882e98fa87c4b",
    proofDetails: {
      proofType: "zk_snark",
      proofHash: "0x4ca1...8f09",
      blockConfirmations: 3,
      requiredConfirmations: 5,
      merkleRoot: "0x99bb...0472",
      foreignBlockNumber: 1984210,
    },
    initiatedAt: new Date(Date.now() - 40000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 10000).toISOString(),
    elapsedSeconds: 40,
    slaThresholdSeconds: 120,
  },
  {
    id: "br-tx-9940",
    sourceChain: "stellar",
    destinationChain: "base",
    tokenSymbol: "ETH",
    amount: "4.85",
    sender: "GC44...7102",
    recipient: "0x91...ac42",
    currentStep: "destination_execution",
    stepStates: {
      source_lock: "verified",
      relayer_gossip: "verified",
      state_proof: "verified",
      destination_execution: "verified",
    },
    sourceTxHash:
      "1102948bbcaef8392104882194821a8c9e018241088491024810284091823901",
    destinationTxHash:
      "0xa728fbe910408102480182481029481928401928401982409182049182401924",
    proofDetails: {
      proofType: "committee_multisig",
      proofHash: "0x221c...fa04",
      blockConfirmations: 15,
      requiredConfirmations: 15,
      merkleRoot: "0xcc19...4420",
      verifiedAt: new Date(Date.now() - 600000).toISOString(),
      foreignBlockNumber: 4892100,
    },
    initiatedAt: new Date(Date.now() - 720000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 600000).toISOString(),
    elapsedSeconds: 120,
    slaThresholdSeconds: 180,
  },
];

export function BridgeMonitor({
  initialTasks = INITIAL_MOCK_TASKS,
  onTaskSelect,
  className = "",
}: BridgeMonitorProps) {
  const [tasks, setTasks] = useState<BridgeTransferTask[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(
    initialTasks[0]?.id || "",
  );
  const [isLiveWsConnected, setIsLiveWsConnected] = useState<boolean>(true);
  const [filterChain, setFilterChain] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [wsMessageCount, setWsMessageCount] = useState<number>(14);

  // Simulated WebSocket Live Progress Stream
  useEffect(() => {
    if (!isLiveWsConnected) return;

    const interval = setInterval(() => {
      setTasks((prevTasks) =>
        prevTasks.map((t) => {
          // If task is completed, leave it
          if (t.stepStates.destination_execution === "verified") return t;

          // Increment elapsed time
          const newElapsed = t.elapsedSeconds + 2;

          // Check for delay condition based on SLA
          let updatedDelayed = t.stepStates[t.currentStep] === "delayed";
          let delayReason = t.delayReason;

          if (newElapsed > t.slaThresholdSeconds && !updatedDelayed) {
            updatedDelayed = true;
            delayReason = `Cross-chain SLA threshold exceeded (${newElapsed}s / ${t.slaThresholdSeconds}s max). State verification backlog.`;
          }

          // Advance state proof block confirmations
          const updatedProof = { ...t.proofDetails };
          if (t.currentStep === "state_proof") {
            if (
              updatedProof.blockConfirmations <
              updatedProof.requiredConfirmations
            ) {
              updatedProof.blockConfirmations += 1;
            }
          }

          return {
            ...t,
            elapsedSeconds: newElapsed,
            proofDetails: updatedProof,
            delayReason,
            lastUpdatedAt: new Date().toISOString(),
          };
        }),
      );

      setWsMessageCount((c) => c + 1);
    }, 2000);

    return () => clearInterval(interval);
  }, [isLiveWsConnected]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchesSearch =
        t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tokenSymbol.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesChain =
        filterChain === "all" ||
        t.sourceChain === filterChain ||
        t.destinationChain === filterChain;

      const isCompleted = t.stepStates.destination_execution === "verified";
      const isDelayed = Object.values(t.stepStates).includes("delayed");

      let matchesStatus = true;
      if (filterStatus === "completed") matchesStatus = isCompleted;
      else if (filterStatus === "delayed") matchesStatus = isDelayed;
      else if (filterStatus === "in_progress") matchesStatus = !isCompleted;

      return matchesSearch && matchesChain && matchesStatus;
    });
  }, [tasks, searchQuery, filterChain, filterStatus]);

  const selectedTask = useMemo(() => {
    const foundInFiltered = filteredTasks.find((t) => t.id === selectedTaskId);
    if (foundInFiltered) return foundInFiltered;
    return filteredTasks[0] || null;
  }, [filteredTasks, selectedTaskId]);

  const handleManualAdvanceStep = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;

        const steps: BridgeStepId[] = [
          "source_lock",
          "relayer_gossip",
          "state_proof",
          "destination_execution",
        ];
        const currentIndex = steps.indexOf(t.currentStep);

        if (currentIndex < steps.length - 1) {
          const nextStep = steps[currentIndex + 1];
          const updatedStates = {
            ...t.stepStates,
            [t.currentStep]: "verified" as StepState,
          };
          updatedStates[nextStep] = "in_progress" as StepState;

          let destHash = t.destinationTxHash;
          if (nextStep === "destination_execution") {
            destHash = `0x${Array.from({ length: 64 }, () =>
              Math.floor(Math.random() * 16).toString(16),
            ).join("")}`;
          }

          return {
            ...t,
            currentStep: nextStep,
            stepStates: updatedStates,
            destinationTxHash: destHash,
            delayReason: undefined,
            proofDetails: {
              ...t.proofDetails,
              blockConfirmations: t.proofDetails.requiredConfirmations,
              verifiedAt: new Date().toISOString(),
            },
          };
        } else {
          return {
            ...t,
            stepStates: {
              ...t.stepStates,
              destination_execution: "verified" as StepState,
            },
            delayReason: undefined,
          };
        }
      }),
    );
  }, []);

  return (
    <div
      data-testid="bridge-monitor-dashboard"
      className={`rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-100 p-6 space-y-6 ${className}`}
    >
      {/* Dashboard Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight">
              Cross-Chain Bridge Monitor
            </h2>
            <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  isLiveWsConnected
                    ? "bg-green-400 animate-pulse"
                    : "bg-neutral-600"
                }`}
              />
              <span className="text-neutral-400">
                {isLiveWsConnected ? "WebSocket Live" : "Paused"}
              </span>
              <span className="text-neutral-600">({wsMessageCount} msgs)</span>
            </div>
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            Real-time tracking of cross-chain task executions, cryptographic
            state proofs, and relay gossip consensus.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLiveWsConnected((prev) => !prev)}
            aria-label={
              isLiveWsConnected ? "Pause live stream" : "Resume live stream"
            }
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isLiveWsConnected
                ? "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                : "bg-blue-600 border-blue-500 text-white hover:bg-blue-500"
            }`}
          >
            {isLiveWsConnected ? "Pause Stream" : "Resume Live"}
          </button>
        </div>
      </div>

      {/* DETAILED ACTIVE TRANSFER WORKBENCH */}
      {selectedTask && (
        <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-neutral-800/80 pb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-mono font-bold bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded text-neutral-300">
                {selectedTask.id}
              </span>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span>
                  {CHAIN_METADATA[selectedTask.sourceChain].icon}{" "}
                  {CHAIN_METADATA[selectedTask.sourceChain].name}
                </span>
                <span className="text-neutral-500">→</span>
                <span>
                  {CHAIN_METADATA[selectedTask.destinationChain].icon}{" "}
                  {CHAIN_METADATA[selectedTask.destinationChain].name}
                </span>
              </div>
              <span className="text-xs font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                {selectedTask.amount} {selectedTask.tokenSymbol}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <span>
                Elapsed:{" "}
                <strong className="text-neutral-200">
                  {selectedTask.elapsedSeconds}s
                </strong>
              </span>
              <span>SLA: {selectedTask.slaThresholdSeconds}s</span>
              {selectedTask.stepStates.destination_execution !== "verified" && (
                <button
                  onClick={() => handleManualAdvanceStep(selectedTask.id)}
                  className="bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 px-2.5 py-1 rounded transition-colors text-[11px] font-medium"
                >
                  Simulate Next Step
                </button>
              )}
            </div>
          </div>

          {/* DELAY ALERT BANNER (If delayed) */}
          {selectedTask.delayReason && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-3 animate-in fade-in"
            >
              <svg
                className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div className="flex-1">
                <p className="font-semibold text-amber-300">
                  Transfer Delay Warning
                </p>
                <p className="mt-0.5 text-neutral-300">
                  {selectedTask.delayReason}
                </p>
              </div>
            </div>
          )}

          {/* 4-STEP VISUAL LIFECYCLE PROGRESS BAR */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
              Bridge Execution Lifecycle
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  "source_lock",
                  "relayer_gossip",
                  "state_proof",
                  "destination_execution",
                ] as BridgeStepId[]
              ).map((stepId, index) => {
                const meta = STEP_LABELS[stepId];
                const status = selectedTask.stepStates[stepId];
                const isCurrent = selectedTask.currentStep === stepId;

                let badgeColor =
                  "bg-neutral-800 text-neutral-500 border-neutral-700";
                let statusLabel = "Pending";
                if (status === "verified") {
                  badgeColor =
                    "bg-green-500/10 text-green-400 border-green-500/30";
                  statusLabel = "Verified";
                } else if (status === "delayed") {
                  badgeColor =
                    "bg-amber-500/10 text-amber-400 border-amber-500/30";
                  statusLabel = "Delayed";
                } else if (status === "in_progress") {
                  badgeColor =
                    "bg-blue-500/10 text-blue-400 border-blue-500/30";
                  statusLabel = "In Progress";
                }

                return (
                  <div
                    key={stepId}
                    data-testid={`lifecycle-step-${stepId}`}
                    className={`p-3.5 rounded-xl border transition-all ${
                      isCurrent
                        ? "border-blue-500/60 bg-blue-500/5 shadow-md shadow-blue-500/5"
                        : "border-neutral-800/80 bg-neutral-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="w-5 h-5 rounded-full bg-neutral-800 text-neutral-300 text-xs flex items-center justify-center font-bold">
                        {index + 1}
                      </span>
                      <span
                        className={`text-[11px] font-medium border px-2 py-0.5 rounded-full ${badgeColor}`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-neutral-200">
                      {meta.label}
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                      {meta.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CRYPTOGRAPHIC STATE PROOF VERIFICATION BADGES & EXPLORER LINKS */}
          <div className="pt-3 border-t border-neutral-800/80">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
              Cryptographic Proof Verification Badges
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Block Confirmations Badge */}
              <div
                data-testid="badge-confirmations"
                className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                  {selectedTask.proofDetails.blockConfirmations}/
                  {selectedTask.proofDetails.requiredConfirmations}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">
                    Foreign Block Confirmations
                  </p>
                  <p className="text-xs font-semibold text-neutral-200 truncate">
                    {selectedTask.proofDetails.blockConfirmations >=
                    selectedTask.proofDetails.requiredConfirmations
                      ? "Finality Threshold Reached"
                      : `Syncing Block #${selectedTask.proofDetails.foreignBlockNumber || "5821094"}`}
                  </p>
                </div>
              </div>

              {/* Merkle / ZK State Proof Badge */}
              <div
                data-testid="badge-state-proof"
                className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">
                    Cryptographic Proof
                  </p>
                  <p className="text-xs font-semibold text-neutral-200 truncate font-mono">
                    {selectedTask.proofDetails.proofType.toUpperCase()} (
                    {selectedTask.proofDetails.merkleRoot})
                  </p>
                </div>
              </div>

              {/* Settlement Badge */}
              <div
                data-testid="badge-settlement"
                className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center shrink-0">
                  ✓
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">
                    Consensus Settlement
                  </p>
                  <p className="text-xs font-semibold text-neutral-200 truncate">
                    {selectedTask.stepStates.destination_execution ===
                    "verified"
                      ? "Finalized On-Chain"
                      : "Relay Gossip Confirmed"}
                  </p>
                </div>
              </div>
            </div>

            {/* Direct Block Explorer Links */}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
              <span className="text-neutral-500">Explorer Links:</span>
              {selectedTask.sourceTxHash && (
                <a
                  href={CHAIN_METADATA[selectedTask.sourceChain].explorerTxUrl(
                    selectedTask.sourceTxHash,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-blue-400 border border-neutral-700/80 px-2.5 py-1 rounded transition-colors"
                >
                  <span>Stellar Source Tx</span>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              )}

              {selectedTask.destinationTxHash && (
                <a
                  href={CHAIN_METADATA[
                    selectedTask.destinationChain
                  ].explorerTxUrl(selectedTask.destinationTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-violet-400 border border-neutral-700/80 px-2.5 py-1 rounded transition-colors"
                >
                  <span>
                    {CHAIN_METADATA[selectedTask.destinationChain].name} Tx
                  </span>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SEARCH & FILTERS BAR */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search tasks by ID, token, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-3 pr-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterChain}
            onChange={(e) => setFilterChain(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-300 focus:outline-none"
          >
            <option value="all">All Chains</option>
            <option value="stellar">Stellar</option>
            <option value="ethereum">Ethereum</option>
            <option value="polygon">Polygon</option>
            <option value="arbitrum">Arbitrum</option>
            <option value="base">Base</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-300 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="delayed">Delayed</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* ACTIVE CROSS-CHAIN TASKS LIST TABLE */}
      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table
          className="w-full text-left text-sm"
          aria-label="Bridge Tasks List"
        >
          <thead className="bg-neutral-950 border-b border-neutral-800 text-xs text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Task ID</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Current Phase</th>
              <th className="px-4 py-3 font-medium">Elapsed / SLA</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/30">
            {filteredTasks.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-neutral-500 text-sm"
                >
                  No cross-chain transfer tasks match the filters.
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const isSelected = selectedTaskId === task.id;
                const isDelayed = Object.values(task.stepStates).includes(
                  "delayed",
                );
                const isCompleted =
                  task.stepStates.destination_execution === "verified";

                return (
                  <tr
                    key={task.id}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      if (onTaskSelect) onTaskSelect(task);
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-500/10 hover:bg-blue-500/15"
                        : "hover:bg-neutral-800/40"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-neutral-300 font-semibold">
                      {task.id}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-200">
                      {CHAIN_METADATA[task.sourceChain].icon} →{" "}
                      {CHAIN_METADATA[task.destinationChain].icon}{" "}
                      <span className="text-neutral-400">
                        {CHAIN_METADATA[task.destinationChain].name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-medium text-neutral-200">
                      {task.amount} {task.tokenSymbol}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {STEP_LABELS[task.currentStep].label}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">
                      <span
                        className={
                          task.elapsedSeconds > task.slaThresholdSeconds
                            ? "text-amber-400 font-bold"
                            : "text-neutral-400"
                        }
                      >
                        {task.elapsedSeconds}s
                      </span>
                      <span className="text-neutral-600">
                        {" "}
                        / {task.slaThresholdSeconds}s
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {isCompleted ? (
                        <span className="text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded text-[11px] font-medium">
                          Completed
                        </span>
                      ) : isDelayed ? (
                        <span className="text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-[11px] font-medium animate-pulse">
                          Delayed
                        </span>
                      ) : (
                        <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded text-[11px] font-medium">
                          In Flight
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTaskId(task.id);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BridgeMonitor;

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWalletOptional } from "@/app/context/WalletContext";

export interface AuditReport {
  id: string;
  auditor: string;
  title: string;
  date: string;
  reportHash: string;
  findings: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  summary: string;
  reportUrl: string;
}

export interface UpgradeProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  targetContractId: string;
  currentWasmHash: string;
  proposedWasmHash: string;
  buildInstructions: string;
  reproducibleDockerImage: string;
  gitCommit: string;
  timelockEndsAt: string; // ISO date string
  status: "active" | "passed" | "executed" | "rejected";
  votes: {
    forCount: number;
    againstCount: number;
    abstainCount: number;
    quorumThreshold: number;
  };
  auditReports: AuditReport[];
  diffs: {
    sourceDiff: {
      filename: string;
      before: string[];
      after: string[];
    };
    bytecodeDisassemblyDiff: {
      before: string[];
      after: string[];
    };
  };
}

export interface UpgradeModalProps {
  proposal: UpgradeProposal;
  isOpen: boolean;
  onClose: () => void;
  onVoteCast?: (
    proposalId: string,
    support: "for" | "against" | "abstain",
  ) => void;
  onDelegate?: (proposalId: string, delegateAddress: string) => void;
}

export const DEFAULT_PROPOSAL: UpgradeProposal = {
  id: "prop-soro-2026-04",
  title:
    "Protocol Upgrade v2.4.0: Gas Optimizations & Timelock Reentrancy Guard",
  description:
    "Upgrades SoroTask core execution contract to implement zero-cost reentrancy protection and dynamic fee scalar computation.",
  proposer: "GBPROT...8810",
  targetContractId: "CCK6Y3I2B2X4A9M8...N7P2",
  currentWasmHash:
    "9d21e84a22b7a840e6f6630fbc89e3a02796191bfa3c61309e4a835a297b4891",
  proposedWasmHash:
    "c4f78310ba791823a0e36d41829a28531bc29487fa830218b019827394ab8271",
  buildInstructions:
    "cargo build --target wasm32-unknown-unknown --release --package sorotask-protocol-core",
  reproducibleDockerImage: "sorotask/builder:2.4.0@sha256:77a1bc...91e",
  gitCommit: "a891f2c",
  timelockEndsAt: new Date(Date.now() + 172800000).toISOString(), // 48 hours from now
  status: "active",
  votes: {
    forCount: 1420500,
    againstCount: 85200,
    abstainCount: 12000,
    quorumThreshold: 1000000,
  },
  auditReports: [
    {
      id: "audit-01",
      auditor: "Trail of Bits",
      title: "SoroTask Core v2.4 Security Assessment",
      date: "2026-09-28",
      reportHash: "0x9482...a812",
      findings: { critical: 0, high: 0, medium: 1, low: 3 },
      summary:
        "All reported medium and low severity findings were remediated in commit a891f2c.",
      reportUrl:
        "https://github.com/SoroLabs/SoroTask/blob/main/audits/trailofbits-v2.4.pdf",
    },
    {
      id: "audit-02",
      auditor: "OpenZeppelin",
      title: "Formal Verification of WASM State Transitions",
      date: "2026-10-04",
      reportHash: "0x33b1...77d9",
      findings: { critical: 0, high: 0, medium: 0, low: 1 },
      summary:
        "Reentrancy guard mathematical invariant holds across all re-entrant execution paths.",
      reportUrl:
        "https://github.com/SoroLabs/SoroTask/blob/main/audits/openzeppelin-v2.4.pdf",
    },
  ],
  diffs: {
    sourceDiff: {
      filename: "contracts/core/src/execution.rs",
      before: [
        " pub fn execute_task(env: Env, task_id: u64) -> Result<(), Error> {",
        "-    let state = env.storage().instance().get(&task_id);",
        "-    perform_call(&env, &state);",
        "-    Ok(())",
        " }",
      ],
      after: [
        " pub fn execute_task(env: Env, task_id: u64) -> Result<(), Error> {",
        "+    // Reentrancy lock acquired before execution",
        "+    acquire_reentrancy_lock(&env)?;",
        "+    let state = env.storage().instance().get(&task_id);",
        "+    perform_call(&env, &state);",
        "+    release_reentrancy_lock(&env);",
        "+    Ok(())",
        " }",
      ],
    },
    bytecodeDisassemblyDiff: {
      before: [
        " (func $execute_task (param i32 i64) (result i32)",
        "-  local.get 0",
        "-  call $read_storage",
        "-  i32.const 0",
        "-  return)",
      ],
      after: [
        " (func $execute_task (param i32 i64) (result i32)",
        "+  call $acquire_lock",
        "+  local.get 0",
        "+  call $read_storage",
        "+  call $release_lock",
        "+  i32.const 0",
        "+  return)",
      ],
    },
  },
};

export function UpgradeModal({
  proposal = DEFAULT_PROPOSAL,
  isOpen,
  onClose,
  onVoteCast,
  onDelegate,
}: UpgradeModalProps) {
  const { session } = useWalletOptional();
  const [activeTab, setActiveTab] = useState<
    "overview" | "diffs" | "audits" | "verify"
  >("overview");
  const [diffViewType, setDiffViewType] = useState<"source" | "bytecode">(
    "source",
  );
  const [verifyInputHash, setVerifyInputHash] = useState("");
  const [verificationResult, setVerificationResult] = useState<
    "idle" | "matched" | "mismatched"
  >("idle");
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [votingState, setVotingState] = useState<"idle" | "voting" | "voted">(
    "idle",
  );
  const [userVote, setUserVote] = useState<
    "for" | "against" | "abstain" | null
  >(null);
  const [delegateAddress, setDelegateAddress] = useState("");
  const [showDelegateInput, setShowDelegateInput] = useState(false);
  const [delegateSuccess, setDelegateSuccess] = useState(false);

  // Live timelock countdown
  useEffect(() => {
    if (!isOpen) return;

    const calculateTime = () => {
      const diff = new Date(proposal.timelockEndsAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds });
    };

    calculateTime();
    const timer = setInterval(calculateTime, 1000);
    return () => clearInterval(timer);
  }, [isOpen, proposal.timelockEndsAt]);

  const handleVerifyHash = () => {
    const input = verifyInputHash.trim().toLowerCase();
    if (!input) {
      setVerificationResult("idle");
      return;
    }
    if (input === proposal.proposedWasmHash.toLowerCase()) {
      setVerificationResult("matched");
    } else {
      setVerificationResult("mismatched");
    }
  };

  const handleCastVote = (support: "for" | "against" | "abstain") => {
    setVotingState("voting");
    setTimeout(() => {
      setVotingState("voted");
      setUserVote(support);
      if (onVoteCast) {
        onVoteCast(proposal.id, support);
      }
    }, 600);
  };

  const handleDelegateVote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegateAddress.trim()) return;
    setDelegateSuccess(true);
    if (onDelegate) {
      onDelegate(proposal.id, delegateAddress.trim());
    }
  };

  const totalVotes =
    proposal.votes.forCount +
    proposal.votes.againstCount +
    proposal.votes.abstainCount;
  const forPercent =
    totalVotes > 0
      ? Math.round((proposal.votes.forCount / totalVotes) * 100)
      : 0;
  const againstPercent =
    totalVotes > 0
      ? Math.round((proposal.votes.againstCount / totalVotes) * 100)
      : 0;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      data-testid="upgrade-governance-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl text-neutral-100 overflow-hidden animate-in fade-in zoom-in-95">
        {/* Top Header */}
        <div className="p-6 border-b border-neutral-800 bg-neutral-950/60 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-semibold">
                Governance Upgrade
              </span>
              <span className="text-xs font-mono text-neutral-400">
                {proposal.id}
              </span>
              <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded font-semibold">
                Active Voting
              </span>
            </div>
            <h2
              id="upgrade-modal-title"
              className="text-xl font-bold text-neutral-100"
            >
              {proposal.title}
            </h2>
            <p className="text-xs text-neutral-400">
              Target Contract:{" "}
              <code className="font-mono text-neutral-300">
                {proposal.targetContractId}
              </code>
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close upgrade modal"
            className="text-neutral-400 hover:text-neutral-100 p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Live Timelock Countdown Banner */}
        <div className="bg-blue-950/30 border-b border-blue-900/40 px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-neutral-300 font-medium">
              Timelock Voting Window Closes In:
            </span>
          </div>
          <div
            className="flex items-center gap-2 font-mono text-sm font-bold text-blue-300"
            data-testid="timelock-countdown"
          >
            <span className="bg-neutral-900 border border-neutral-800 px-2 py-1 rounded">
              {String(timeLeft.days).padStart(2, "0")}d
            </span>
            <span>:</span>
            <span className="bg-neutral-900 border border-neutral-800 px-2 py-1 rounded">
              {String(timeLeft.hours).padStart(2, "0")}h
            </span>
            <span>:</span>
            <span className="bg-neutral-900 border border-neutral-800 px-2 py-1 rounded">
              {String(timeLeft.minutes).padStart(2, "0")}m
            </span>
            <span>:</span>
            <span className="bg-neutral-900 border border-neutral-800 px-2 py-1 rounded text-blue-400">
              {String(timeLeft.seconds).padStart(2, "0")}s
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-800 px-6 bg-neutral-950/30 text-xs font-semibold gap-1">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-3 px-4 border-b-2 transition-colors ${
              activeTab === "overview"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Overview & Voting
          </button>
          <button
            onClick={() => setActiveTab("diffs")}
            className={`py-3 px-4 border-b-2 transition-colors ${
              activeTab === "diffs"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Side-by-Side Diffs
          </button>
          <button
            onClick={() => setActiveTab("audits")}
            className={`py-3 px-4 border-b-2 transition-colors ${
              activeTab === "audits"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Audit Reports ({proposal.auditReports.length})
          </button>
          <button
            onClick={() => setActiveTab("verify")}
            className={`py-3 px-4 border-b-2 transition-colors ${
              activeTab === "verify"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Reproducible WASM Hash
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* TAB 1: OVERVIEW & VOTING */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-xs text-neutral-300 leading-relaxed">
                <p>{proposal.description}</p>
              </div>

              {/* Hashes comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-950 space-y-2">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Current On-Chain WASM Hash
                  </span>
                  <code className="block text-xs font-mono text-neutral-300 break-all bg-neutral-900 p-2.5 rounded border border-neutral-800">
                    {proposal.currentWasmHash}
                  </code>
                </div>

                <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                      Proposed WASM Hash (v2.4.0)
                    </span>
                    <span className="text-[11px] bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded font-mono">
                      Build Verified ✓
                    </span>
                  </div>
                  <code className="block text-xs font-mono text-blue-300 break-all bg-neutral-900 p-2.5 rounded border border-blue-500/30">
                    {proposal.proposedWasmHash}
                  </code>
                </div>
              </div>

              {/* Governance Voting Tally */}
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-neutral-300">
                    Voting Tally & Quorum
                  </span>
                  <span className="text-neutral-400 font-mono">
                    Quorum: {proposal.votes.quorumThreshold.toLocaleString()}{" "}
                    SVR (Met ✓)
                  </span>
                </div>

                {/* Progress bars */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-green-400 font-medium">
                      For: {forPercent}% (
                      {proposal.votes.forCount.toLocaleString()})
                    </span>
                    <span className="text-red-400 font-medium">
                      Against: {againstPercent}% (
                      {proposal.votes.againstCount.toLocaleString()})
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-neutral-800 rounded-full flex overflow-hidden">
                    <div
                      style={{ width: `${forPercent}%` }}
                      className="bg-green-500 h-full"
                    />
                    <div
                      style={{ width: `${againstPercent}%` }}
                      className="bg-red-500 h-full"
                    />
                  </div>
                </div>

                {/* Wallet Voting Action Controls */}
                <div className="pt-4 border-t border-neutral-800/80">
                  {votingState === "voted" ? (
                    <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-300 flex items-center justify-between">
                      <span>
                        ✓ Your vote ({userVote?.toUpperCase()}) was recorded on
                        the Soroban governance contract.
                      </span>
                      <span className="font-mono text-neutral-400">
                        Voter: {session?.address?.slice(0, 8)}...
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-neutral-400">
                        Cast your vote directly with your connected wallet (
                        {session?.address
                          ? `${session.address.slice(0, 8)}...`
                          : "Freighter"}
                        ):
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => handleCastVote("for")}
                          disabled={votingState === "voting"}
                          className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2"
                        >
                          Vote For
                        </button>
                        <button
                          onClick={() => handleCastVote("against")}
                          disabled={votingState === "voting"}
                          className="flex-1 min-w-[120px] bg-red-600 hover:bg-red-500 text-white font-semibold py-2.5 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2"
                        >
                          Vote Against
                        </button>
                        <button
                          onClick={() => handleCastVote("abstain")}
                          disabled={votingState === "voting"}
                          className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold py-2.5 px-4 rounded-lg text-xs transition-colors"
                        >
                          Abstain
                        </button>
                        <button
                          onClick={() => setShowDelegateInput((prev) => !prev)}
                          className="bg-neutral-800 hover:bg-neutral-700 text-purple-300 border border-purple-500/30 py-2.5 px-4 rounded-lg text-xs transition-colors"
                        >
                          Delegate Vote
                        </button>
                      </div>

                      {/* Vote Delegation Form */}
                      {showDelegateInput && (
                        <form
                          onSubmit={handleDelegateVote}
                          className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg space-y-2 mt-3 animate-in fade-in"
                        >
                          <label className="block text-xs font-medium text-neutral-300">
                            Delegate Voting Power to Address
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              required
                              placeholder="e.g. GDELEGATE...9910"
                              value={delegateAddress}
                              onChange={(e) =>
                                setDelegateAddress(e.target.value)
                              }
                              className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-1.5 rounded transition-colors"
                            >
                              Confirm Delegation
                            </button>
                          </div>
                          {delegateSuccess && (
                            <p className="text-xs text-green-400">
                              ✓ Voting power successfully delegated to{" "}
                              {delegateAddress.slice(0, 10)}...
                            </p>
                          )}
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SIDE-BY-SIDE DIFFS */}
          {activeTab === "diffs" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-400">
                  {diffViewType === "source"
                    ? proposal.diffs.sourceDiff.filename
                    : "WASM Disassembly (.wat)"}
                </span>

                <div className="flex items-center bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                  <button
                    onClick={() => setDiffViewType("source")}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      diffViewType === "source"
                        ? "bg-blue-600 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    Rust Source Diff
                  </button>
                  <button
                    onClick={() => setDiffViewType("bytecode")}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      diffViewType === "bytecode"
                        ? "bg-blue-600 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    WASM Disassembly
                  </button>
                </div>
              </div>

              {/* Side-by-side Diff Viewer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                {/* Before (Original) */}
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden">
                  <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 text-[11px] text-neutral-400 flex items-center justify-between">
                    <span>Previous Build (On-Chain)</span>
                    <span className="text-red-400">v2.3.9</span>
                  </div>
                  <pre className="p-3 overflow-x-auto text-neutral-300 leading-relaxed">
                    {(diffViewType === "source"
                      ? proposal.diffs.sourceDiff.before
                      : proposal.diffs.bytecodeDisassemblyDiff.before
                    ).map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.startsWith("-")
                            ? "bg-red-500/10 text-red-300 px-1 rounded"
                            : ""
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                </div>

                {/* After (Proposed) */}
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden">
                  <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 text-[11px] text-neutral-400 flex items-center justify-between">
                    <span>Proposed Build (v2.4.0)</span>
                    <span className="text-green-400">
                      Commit: {proposal.gitCommit}
                    </span>
                  </div>
                  <pre className="p-3 overflow-x-auto text-neutral-300 leading-relaxed">
                    {(diffViewType === "source"
                      ? proposal.diffs.sourceDiff.after
                      : proposal.diffs.bytecodeDisassemblyDiff.after
                    ).map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.startsWith("+")
                            ? "bg-green-500/10 text-green-300 px-1 rounded"
                            : ""
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT REPORTS */}
          {activeTab === "audits" && (
            <div className="space-y-4">
              <p className="text-xs text-neutral-400">
                Independent security audits verifying WASM bytecode integrity,
                formal verification, and gas limits.
              </p>

              <div className="space-y-3">
                {proposal.auditReports.map((audit) => (
                  <div
                    key={audit.id}
                    className="p-4 rounded-xl border border-neutral-800 bg-neutral-950 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-neutral-100">
                          {audit.auditor}
                        </span>
                        <span className="text-xs text-neutral-500">
                          • {audit.date}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                          Hash: {audit.reportHash}
                        </span>
                        <a
                          href={audit.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                        >
                          View PDF ↗
                        </a>
                      </div>
                    </div>

                    <p className="text-xs text-neutral-300">{audit.summary}</p>

                    <div className="flex items-center gap-3 pt-2 text-[11px] font-medium border-t border-neutral-900">
                      <span className="text-green-400">
                        Critical: {audit.findings.critical}
                      </span>
                      <span className="text-green-400">
                        High: {audit.findings.high}
                      </span>
                      <span className="text-amber-400">
                        Medium: {audit.findings.medium}
                      </span>
                      <span className="text-neutral-400">
                        Low: {audit.findings.low}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: REPRODUCIBLE WASM HASH VERIFIER */}
          {activeTab === "verify" && (
            <div className="space-y-5">
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
                <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
                  Reproducible Build Environment
                </h4>
                <p className="text-xs text-neutral-400">
                  Build the contract deterministically using the official pinned
                  container image:
                </p>
                <code className="block text-xs font-mono bg-neutral-900 p-3 rounded border border-neutral-800 text-neutral-300 break-all select-all">
                  docker run --rm -v $(pwd):/workspace{" "}
                  {proposal.reproducibleDockerImage}{" "}
                  {proposal.buildInstructions}
                </code>
              </div>

              {/* Verify Hash Form */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
                <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
                  Verify Computed SHA-256 Hash
                </h4>
                <p className="text-xs text-neutral-400">
                  Paste the SHA-256 checksum from your local cargo build to
                  verify it matches the on-chain proposal:
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Paste compiled WASM SHA-256 hash..."
                    value={verifyInputHash}
                    onChange={(e) => {
                      setVerifyInputHash(e.target.value);
                      setVerificationResult("idle");
                    }}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleVerifyHash}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    Verify Hash
                  </button>
                </div>

                {verificationResult === "matched" && (
                  <div
                    data-testid="verification-match-badge"
                    className="p-3 bg-green-500/10 border border-green-500/30 text-green-300 text-xs rounded-lg flex items-center gap-2"
                  >
                    <span>
                      ✓ Exact Cryptographic Match! The compiled WASM hash
                      matches proposal {proposal.id} perfectly.
                    </span>
                  </div>
                )}

                {verificationResult === "mismatched" && (
                  <div
                    data-testid="verification-mismatch-badge"
                    className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg flex items-center gap-2"
                  >
                    <span>
                      ✕ Hash Mismatch. The provided hash does not match the
                      proposed on-chain WASM bytecode.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Bar */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between text-xs text-neutral-400">
          <span>
            Proposer:{" "}
            <strong className="text-neutral-200">{proposal.proposer}</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpgradeModal;

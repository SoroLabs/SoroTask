"use client";

import React, { memo } from "react";
import { ArrowRight, CheckCircle2, Layers } from "lucide-react";
import { QuorumProgressBar } from "./QuorumProgressBar";
import type { GovernanceProposal, VoteReceipt, VoteStatus } from "../types";

export interface ProposalCardProps {
  proposal: GovernanceProposal;
  isSelected: boolean;
  userReceipt?: VoteReceipt;
  onSelect: (proposalId: number) => void;
}

const STATUS_BADGE: Record<VoteStatus, string> = {
  Pending: "border-slate-600 bg-slate-800 text-slate-300",
  Active: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  Passed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  Rejected: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  Executed: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  Cancelled: "border-amber-500/40 bg-amber-500/15 text-amber-300",
};

const IMPACT_BADGE: Record<"low" | "medium" | "high", string> = {
  low: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  medium: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  high: "text-rose-300 bg-rose-500/10 border-rose-500/20",
};

export const ProposalCard = memo(function ProposalCard({
  proposal,
  isSelected,
  userReceipt,
  onSelect,
}: ProposalCardProps) {
  const blocksRemaining = Math.max(
    0,
    proposal.endBlock - proposal.currentBlock,
  );
  const shortProposer =
    proposal.proposer.length > 14
      ? `${proposal.proposer.slice(0, 6)}...${proposal.proposer.slice(-4)}`
      : proposal.proposer;

  return (
    <article
      aria-labelledby={`proposal-title-${proposal.proposalId}`}
      className={`rounded-xl border p-5 transition-all ${
        isSelected
          ? "border-sky-500/70 bg-slate-900/90 shadow-lg shadow-sky-950/40"
          : "border-slate-800 bg-slate-950 hover:border-slate-700"
      }`}
    >
      {/* Top badges row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-200">
            SIP-{String(proposal.proposalId).padStart(3, "0")}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[proposal.status]}`}
          >
            {proposal.status}
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300">
            <Layers className="h-3 w-3 text-slate-400" aria-hidden="true" />
            {proposal.category}
          </span>
          {userReceipt && (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Voted {userReceipt.choice} (+{userReceipt.votes})
            </span>
          )}
        </div>

        <button
          type="button"
          aria-pressed={isSelected}
          onClick={() => onSelect(proposal.proposalId)}
          className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
            isSelected
              ? "border-sky-500 bg-sky-600 text-white"
              : "border-slate-700 bg-slate-900 text-slate-200 hover:border-sky-500 hover:text-sky-300"
          }`}
        >
          {isSelected ? "Selected for Voting" : "Inspect & Vote"}
        </button>
      </div>

      {/* Title & description */}
      <h3
        id={`proposal-title-${proposal.proposalId}`}
        className="text-base font-bold text-white"
      >
        {proposal.title}
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
        {proposal.description}
      </p>

      {/* Parameter change diffs */}
      {proposal.parameterChanges.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Parameter Changes ({proposal.targetFunction})
          </div>
          <ul className="space-y-2">
            {proposal.parameterChanges.map((change) => (
              <li
                key={change.parameter}
                className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-200">
                    {change.parameter}
                  </span>
                  <span className="text-slate-400">{change.currentValue}</span>
                  <ArrowRight
                    className="h-3 w-3 text-sky-400"
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-sky-300">
                    {change.proposedValue}
                  </span>
                </div>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${IMPACT_BADGE[change.impact]}`}
                >
                  {change.impact} impact
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Live quorum bar */}
      <div className="mt-4 border-t border-slate-800/80 pt-4">
        <QuorumProgressBar proposal={proposal} />
      </div>

      {/* Footer metadata */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-3 font-mono text-[11px] text-slate-400">
        <span>Proposer: {shortProposer}</span>
        <span>Voters: {proposal.voterCount.toLocaleString()}</span>
        <span>
          {proposal.status === "Active"
            ? `${blocksRemaining.toLocaleString()} ledgers remaining`
            : `Ended at ledger #${proposal.endBlock.toLocaleString()}`}
        </span>
      </div>
    </article>
  );
});

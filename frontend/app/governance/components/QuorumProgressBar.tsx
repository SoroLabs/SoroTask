"use client";

import React, { memo, useMemo } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { computeQuorumMetrics, projectVoteImpact } from "../quadratic";
import type { GovernanceProposal, VoteChoice } from "../types";

export interface QuorumProgressBarProps {
  proposal: Pick<
    GovernanceProposal,
    | "proposalId"
    | "votesFor"
    | "votesAgainst"
    | "votesAbstain"
    | "quorumThreshold"
    | "approvalThresholdBps"
  >;
  projectedChoice?: VoteChoice;
  projectedAdditionalVotes?: number;
  compact?: boolean;
}

export const QuorumProgressBar = memo(function QuorumProgressBar({
  proposal,
  projectedChoice,
  projectedAdditionalVotes = 0,
  compact = false,
}: QuorumProgressBarProps) {
  const metrics = useMemo(() => computeQuorumMetrics(proposal), [proposal]);

  const projected = useMemo(() => {
    if (!projectedChoice || projectedAdditionalVotes <= 0) return null;
    return projectVoteImpact(
      proposal,
      projectedChoice,
      projectedAdditionalVotes,
    );
  }, [proposal, projectedChoice, projectedAdditionalVotes]);

  const projectedDeltaPct = projected
    ? Math.max(
        0,
        Number(
          (projected.quorumProgressPct - metrics.quorumProgressPct).toFixed(1),
        ),
      )
    : 0;

  return (
    <div className="space-y-2.5">
      {/* Quorum header row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-slate-200">
          {metrics.quorumReached ? (
            <CheckCircle2
              className="h-3.5 w-3.5 text-emerald-400"
              aria-hidden="true"
            />
          ) : (
            <Clock className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          )}
          <span>Quorum Progress</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              metrics.quorumReached
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
            }`}
          >
            {metrics.quorumReached ? "Quorum Met" : "In Progress"}
          </span>
        </div>

        <div className="font-mono text-[11px] text-slate-300">
          <strong className="text-white">
            {metrics.totalVotesCast.toLocaleString()}
          </strong>{" "}
          / {metrics.quorumThreshold.toLocaleString()} votes (
          {metrics.quorumProgressPct}%)
          {projected && projectedDeltaPct > 0 && (
            <span className="ml-1.5 text-sky-400">
              ? {projected.quorumProgressPct}%
            </span>
          )}
        </div>
      </div>

      {/* Primary quorum progress bar */}
      <div
        role="progressbar"
        aria-label={`Proposal SIP-${String(proposal.proposalId).padStart(3, "0")} quorum progress`}
        aria-valuenow={Math.round(metrics.quorumProgressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${metrics.totalVotesCast} of ${metrics.quorumThreshold} votes (${metrics.quorumProgressPct}%)`}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          className={`h-full transition-all duration-300 ${
            metrics.quorumReached
              ? "bg-gradient-to-r from-emerald-500 to-teal-400"
              : "bg-gradient-to-r from-sky-500 to-indigo-400"
          }`}
          style={{ width: `${metrics.quorumProgressPct}%` }}
        />
        {projected && projectedDeltaPct > 0 && (
          <div
            aria-hidden="true"
            className="absolute top-0 h-full bg-sky-300/45 transition-all duration-200"
            style={{
              left: `${metrics.quorumProgressPct}%`,
              width: `${Math.min(100 - metrics.quorumProgressPct, projectedDeltaPct)}%`,
            }}
          />
        )}
      </div>

      {/* Segmented vote distribution bar */}
      {!compact && (
        <div className="space-y-1.5 pt-0.5">
          <div
            role="img"
            aria-label="Vote tally distribution across For, Against, and Abstain"
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80"
          >
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{ width: `${metrics.forPct}%` }}
            />
            <div
              className="bg-rose-500 transition-all duration-300"
              style={{ width: `${metrics.againstPct}%` }}
            />
            <div
              className="bg-slate-400 transition-all duration-300"
              style={{ width: `${metrics.abstainPct}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-emerald-300">
                For: {proposal.votesFor.toLocaleString()} ({metrics.forPct}%)
              </span>
              <span className="text-rose-300">
                Against: {proposal.votesAgainst.toLocaleString()} (
                {metrics.againstPct}%)
              </span>
              <span className="text-slate-300">
                Abstain: {proposal.votesAbstain.toLocaleString()} (
                {metrics.abstainPct}%)
              </span>
            </div>
            <span>
              Approval:{" "}
              <strong className="text-slate-200">{metrics.approvalPct}%</strong>{" "}
              (req {metrics.approvalThresholdPct}%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

"use client";

import React, { memo, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { calculateQuadraticVote } from "../quadratic";
import { QuorumProgressBar } from "./QuorumProgressBar";
import type { GovernanceProposal, VoteChoice, VoteReceipt } from "../types";

export interface QuadraticVoteCalculatorProps {
  proposal: GovernanceProposal | null;
  availableStake: number;
  isWalletConnected: boolean;
  isWalletConnecting: boolean;
  isPreviewStake: boolean;
  isSigningVote: boolean;
  voteError: string | null;
  receipt?: VoteReceipt;
  onConnectWallet: () => Promise<void>;
  onCastVote: (
    proposalId: number,
    choice: VoteChoice,
    votes: number,
  ) => Promise<VoteReceipt | null>;
}

const VOTE_CHOICES: Array<{
  value: VoteChoice;
  label: string;
  activeClass: string;
}> = [
  {
    value: "For",
    label: "Vote For",
    activeClass: "border-emerald-500 bg-emerald-500/20 text-emerald-200",
  },
  {
    value: "Against",
    label: "Vote Against",
    activeClass: "border-rose-500 bg-rose-500/20 text-rose-200",
  },
  {
    value: "Abstain",
    label: "Abstain",
    activeClass: "border-slate-400 bg-slate-700/60 text-slate-100",
  },
];

export const QuadraticVoteCalculator = memo(function QuadraticVoteCalculator({
  proposal,
  availableStake,
  isWalletConnected,
  isWalletConnecting,
  isPreviewStake,
  isSigningVote,
  voteError,
  receipt,
  onConnectWallet,
  onCastVote,
}: QuadraticVoteCalculatorProps) {
  const [choice, setChoice] = useState<VoteChoice>("For");
  const [desiredVotes, setDesiredVotes] = useState<number>(10);

  const existingTotalVotes = proposal
    ? proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain
    : 0;

  const calculation = useMemo(
    () =>
      calculateQuadraticVote(desiredVotes, availableStake, existingTotalVotes),
    [desiredVotes, availableStake, existingTotalVotes],
  );

  const sliderMax = Math.max(1, calculation.maxVotes);
  const clampedSliderValue = Math.min(Math.max(0, desiredVotes), sliderMax);
  const isProposalActive = proposal?.status === "Active";

  const handlePreset = (fraction: number) => {
    const next = Math.max(1, Math.floor(calculation.maxVotes * fraction));
    setDesiredVotes(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposal || !isProposalActive || !calculation.canAfford) return;
    await onCastVote(proposal.proposalId, choice, calculation.desiredVotes);
  };

  if (!proposal) {
    return (
      <section
        aria-label="Quadratic voting calculator"
        className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-slate-300"
      >
        Select a proposal to calculate quadratic voting power and cast a vote.
      </section>
    );
  }

  return (
    <section
      aria-labelledby="quadratic-calculator-heading"
      className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-white shadow-xl"
    >
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-sky-400" aria-hidden="true" />
          <div>
            <h2
              id="quadratic-calculator-heading"
              className="text-base font-bold tracking-tight"
            >
              Quadratic Vote Calculator
            </h2>
            <p className="text-xs text-slate-400">
              Cost scales quadratically:{" "}
              <code className="text-sky-300">cost = votes²</code>
            </p>
          </div>
        </div>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-sky-300">
          SIP-{String(proposal.proposalId).padStart(3, "0")}
        </span>
      </div>

      {/* Stake context bar */}
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">
            {isPreviewStake
              ? "Preview Stake (connect Freighter to sign)"
              : "Available Wallet Stake"}
          </span>
          <span className="font-mono font-semibold text-white">
            {availableStake.toLocaleString()} XLM
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>Max Quadratic Power</span>
          <span className="font-mono text-emerald-300">
            {calculation.maxVotes.toLocaleString()} votes
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Vote Choice selector */}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-slate-300">
            Ballot Choice
          </legend>
          <div
            role="radiogroup"
            aria-label="Ballot choice"
            className="grid grid-cols-3 gap-2"
          >
            {VOTE_CHOICES.map((option) => {
              const selected = choice === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!isProposalActive || isSigningVote}
                  onClick={() => setChoice(option.value)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 ${
                    selected
                      ? option.activeClass
                      : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Desired votes slider + numeric input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="quadratic-votes-input"
              className="text-xs font-semibold text-slate-300"
            >
              Desired Votes
            </label>
            <div className="flex items-center gap-1.5">
              {[
                { label: "25%", frac: 0.25 },
                { label: "50%", frac: 0.5 },
                { label: "75%", frac: 0.75 },
                { label: "Max", frac: 1 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={!isProposalActive || calculation.maxVotes === 0}
                  onClick={() => handlePreset(preset.frac)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:border-sky-500 hover:text-sky-300 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="quadratic-votes-slider"
              type="range"
              aria-label="Quadratic votes slider"
              min={0}
              max={sliderMax}
              step={1}
              value={clampedSliderValue}
              disabled={!isProposalActive || calculation.maxVotes === 0}
              onChange={(e) => setDesiredVotes(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-sky-500"
            />
            <input
              id="quadratic-votes-input"
              type="number"
              min={0}
              max={Math.max(10_000, calculation.maxVotes * 2)}
              step={1}
              value={desiredVotes}
              disabled={!isProposalActive}
              onChange={(e) => {
                const raw = e.target.value;
                setDesiredVotes(
                  raw === "" ? 0 : Math.max(0, Math.floor(Number(raw))),
                );
              }}
              className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-right font-mono text-xs text-white focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
        </div>

        {/* Live quadratic cost metrics */}
        <dl className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
          <div>
            <dt className="text-[11px] text-slate-400">Stake Cost (v²)</dt>
            <dd
              data-testid="quadratic-stake-cost"
              className="mt-0.5 font-mono text-sm font-bold text-white"
            >
              {calculation.stakeRequired.toLocaleString()} XLM
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Remaining Stake</dt>
            <dd
              data-testid="quadratic-remaining-stake"
              className="mt-0.5 font-mono text-sm font-semibold text-slate-200"
            >
              {calculation.remainingStake.toLocaleString()} XLM
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">
              Next Vote Marginal Cost
            </dt>
            <dd
              data-testid="quadratic-marginal-cost"
              className="mt-0.5 font-mono text-xs font-semibold text-sky-300"
            >
              +{calculation.marginalNextVoteCost.toLocaleString()} XLM
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Projected Share</dt>
            <dd className="mt-0.5 font-mono text-xs font-semibold text-emerald-300">
              {calculation.votingPowerSharePct}% of tally
            </dd>
          </div>
        </dl>

        {/* Live projected quorum preview */}
        <div className="rounded-lg border border-slate-800/80 bg-slate-900/30 p-3">
          <QuorumProgressBar
            proposal={proposal}
            projectedChoice={choice}
            projectedAdditionalVotes={
              calculation.canAfford ? calculation.desiredVotes : 0
            }
            compact
          />
        </div>

        {/* Validation / signing errors */}
        {!isProposalActive && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300"
          >
            Voting is closed for this proposal ({proposal.status}).
          </div>
        )}

        {isProposalActive && calculation.validationError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{calculation.validationError}</span>
          </div>
        )}

        {voteError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{voteError}</span>
          </div>
        )}

        {/* 1-Click Freighter Sign & Vote action */}
        {isWalletConnected ? (
          <button
            type="submit"
            disabled={
              !isProposalActive || !calculation.canAfford || isSigningVote
            }
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            {isSigningVote ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Waiting for Freighter Signature...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Sign & Cast {calculation.desiredVotes} {choice} Vote
                {calculation.desiredVotes === 1 ? "" : "s"} (Freighter)
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={isWalletConnecting}
            onClick={() => void onConnectWallet()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-indigo-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            <Wallet className="h-4 w-4" aria-hidden="true" />
            {isWalletConnecting
              ? "Connecting Freighter..."
              : "Connect Freighter to Sign Vote"}
          </button>
        )}
      </form>

      {/* Signed Vote Receipt */}
      {receipt && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100"
        >
          <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Vote Signed & Broadcast via Freighter
          </div>
          <div className="mt-1.5 space-y-1 font-mono text-[11px] text-emerald-100/90">
            <div>
              Ballot: +{receipt.votes} {receipt.choice} (
              {receipt.stakeCommitted.toLocaleString()} XLM committed)
            </div>
            <div className="truncate" title={receipt.txHash}>
              Tx Hash: {receipt.txHash}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

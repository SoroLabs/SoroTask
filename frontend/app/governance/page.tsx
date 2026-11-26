"use client";

import React, { useMemo, useState } from "react";
import {
  Radio,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { AuditLogImmutableView } from "@/app/components/AuditLogImmutableView";
import { ProposalCard } from "./components/ProposalCard";
import { QuadraticVoteCalculator } from "./components/QuadraticVoteCalculator";
import { computeQuorumMetrics } from "./quadratic";
import { useGovernancePortal } from "./useGovernancePortal";
import { GOVERNANCE_STATUS_FILTERS, type VoteStatus } from "./types";

type StatusFilter = "All" | VoteStatus;

const STATUS_FILTERS = GOVERNANCE_STATUS_FILTERS;

export default function GovernancePage() {
  const portal = useGovernancePortal();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProposals = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return portal.proposals.filter((proposal) => {
      if (statusFilter !== "All" && proposal.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        proposal.title.toLowerCase().includes(query) ||
        proposal.description.toLowerCase().includes(query) ||
        proposal.category.toLowerCase().includes(query) ||
        `sip-${String(proposal.proposalId).padStart(3, "0")}`.includes(query) ||
        proposal.parameterChanges.some((c) =>
          c.parameter.toLowerCase().includes(query),
        )
      );
    });
  }, [portal.proposals, statusFilter, searchQuery]);

  const summaryMetrics = useMemo(() => {
    let activeCount = 0;
    let totalVotes = 0;
    let quorumMetCount = 0;

    for (const proposal of portal.proposals) {
      if (proposal.status === "Active") activeCount += 1;
      const q = computeQuorumMetrics(proposal);
      totalVotes += q.totalVotesCast;
      if (q.quorumReached) quorumMetCount += 1;
    }

    return {
      activeCount,
      totalVotes,
      quorumMetCount,
      totalProposals: portal.proposals.length,
    };
  }, [portal.proposals]);

  const indexerBadge =
    portal.indexerState === "live"
      ? {
          label: "Indexer GraphQL Live",
          className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
        }
      : portal.indexerState === "connecting" ||
          portal.indexerState === "reconnecting"
        ? {
            label: "Syncing Indexer...",
            className: "border-sky-500/30 bg-sky-500/15 text-sky-300",
          }
        : {
            label: "Cached Snapshot (GraphQL Standby)",
            className: "border-amber-500/30 bg-amber-500/15 text-amber-200",
          };

  const shortAddress = portal.walletAddress
    ? `${portal.walletAddress.slice(0, 6)}...${portal.walletAddress.slice(-4)}`
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Portal Header */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15 text-sky-300">
              <Scale className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                SoroTask DAO Governance Portal
              </h1>
              <p className="text-xs text-slate-400">
                Inspect parameter proposals, compute quadratic voting weight,
                and sign votes with Freighter.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium ${indexerBadge.className}`}
            >
              <Radio className="h-3 w-3" aria-hidden="true" />
              {indexerBadge.label}
            </span>

            <button
              type="button"
              onClick={() => void portal.refreshFromIndexer()}
              aria-label="Refresh governance tallies from indexer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Sync
            </button>

            {portal.isWalletConnected ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs">
                <Wallet
                  className="h-3.5 w-3.5 text-emerald-400"
                  aria-hidden="true"
                />
                <span className="font-mono text-emerald-200">
                  {shortAddress} � {portal.availableStake.toLocaleString()} XLM
                </span>
                <button
                  type="button"
                  onClick={portal.disconnectWallet}
                  className="ml-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={portal.isWalletConnecting}
                onClick={() => void portal.connectWallet()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                {portal.isWalletConnecting
                  ? "Connecting..."
                  : "Connect Freighter"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-6">
        {/* KPI Overview */}
        <section aria-label="Governance telemetry overview">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <dt className="text-xs text-slate-400">Active Proposals</dt>
              <dd className="mt-1 font-mono text-2xl font-bold text-white">
                {summaryMetrics.activeCount}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <dt className="text-xs text-slate-400">
                Live Quadratic Votes Cast
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold text-sky-300">
                {summaryMetrics.totalVotes.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <dt className="text-xs text-slate-400">Quorum Reached</dt>
              <dd className="mt-1 font-mono text-2xl font-bold text-emerald-300">
                {summaryMetrics.quorumMetCount} /{" "}
                {summaryMetrics.totalProposals}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <dt className="text-xs text-slate-400">Verified Audit Entries</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono text-2xl font-bold text-white">
                <ShieldCheck
                  className="h-5 w-5 text-emerald-400"
                  aria-hidden="true"
                />
                {portal.auditLogs.length}
              </dd>
            </div>
          </dl>
        </section>

        {/* Proposals + Sticky Quadratic Calculator */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section
            aria-labelledby="proposals-heading"
            className="space-y-4 lg:col-span-7 xl:col-span-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="proposals-heading"
                className="text-lg font-bold text-white"
              >
                Parameter & Protocol Proposals
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search governance proposals"
                    placeholder="Filter proposals or parameters..."
                    className="w-56 rounded-md border border-slate-800 bg-slate-900 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                <div
                  role="group"
                  aria-label="Filter proposals by status"
                  className="flex rounded-md border border-slate-800 bg-slate-900/60 p-0.5 text-xs"
                >
                  {STATUS_FILTERS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={statusFilter === status}
                      onClick={() => setStatusFilter(status)}
                      className={`rounded px-2.5 py-1 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                        statusFilter === status
                          ? "bg-slate-800 text-white"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredProposals.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-8 text-center text-sm text-slate-400">
                No governance proposals match the current filter.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.proposalId}
                    proposal={proposal}
                    isSelected={
                      proposal.proposalId === portal.selectedProposalId
                    }
                    userReceipt={portal.receiptsByProposal[proposal.proposalId]}
                    onSelect={portal.selectProposal}
                  />
                ))}
              </div>
            )}
          </section>

          <aside
            aria-label="Voting workspace"
            className="lg:col-span-5 xl:col-span-4"
          >
            <div className="lg:sticky lg:top-6">
              <QuadraticVoteCalculator
                proposal={portal.selectedProposal}
                availableStake={portal.availableStake}
                isWalletConnected={portal.isWalletConnected}
                isWalletConnecting={portal.isWalletConnecting}
                isPreviewStake={portal.isPreviewStake}
                isSigningVote={portal.isSigningVote}
                voteError={portal.voteError}
                receipt={
                  portal.selectedProposal
                    ? portal.receiptsByProposal[
                        portal.selectedProposal.proposalId
                      ]
                    : undefined
                }
                onConnectWallet={portal.connectWallet}
                onCastVote={portal.castVote}
              />
            </div>
          </aside>
        </div>

        {/* Immutable Audit Log Section */}
        <AuditLogImmutableView
          initialLogs={portal.auditLogs}
          onVerifyEntryTamper={portal.verifyAuditEntry}
          pageSize={10}
          title="Immutable Governance Audit Log"
          subtitle="Tamper-evident ledger of governance proposals, live indexed tallies, and Freighter-signed quadratic votes"
        />
      </main>
    </div>
  );
}

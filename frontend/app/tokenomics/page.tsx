"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiActivity,
  FiDatabase,
  FiSliders,
  FiTrendingUp,
  FiClock,
  FiShield,
} from "react-icons/fi";
import { MdAccountBalanceWallet } from "react-icons/md";
import SankeyDiagram from "@/src/components/graph/SankeyDiagram";
import { TokenomicsPieChart } from "@/src/components/tokenomics/TokenomicsPieChart";
import { VestingScheduleTable } from "@/src/components/tokenomics/VestingScheduleTable";
import { UnstakingTimelockTracker } from "@/src/components/tokenomics/UnstakingTimelockTracker";
import { RewardClaimModal } from "@/src/components/RewardClaimModal";
import { useWalletOptional } from "@/app/context/WalletContext";
import { useStakingVault } from "@/app/tokenomics/hooks/useStakingVault";
import { formatStakingNumber } from "@/app/tokenomics/lib/stakingVaultMath";
import { TokenAllocation, VestingMilestone } from "@/src/types/tokenomics";

const INITIAL_ALLOCATIONS: TokenAllocation[] = [
  {
    id: "treasury",
    category: "Community Treasury",
    percentage: 35,
    amountMillion: 35,
    color: "#3B82F6",
    cliffMonths: 0,
    vestingMonths: 36,
  },
  {
    id: "staking",
    category: "Staking Emissions",
    percentage: 25,
    amountMillion: 25,
    color: "#10B981",
    cliffMonths: 0,
    vestingMonths: 48,
  },
  {
    id: "team",
    category: "Team & Founders",
    percentage: 20,
    amountMillion: 20,
    color: "#8B5CF6",
    cliffMonths: 6,
    vestingMonths: 36,
  },
  {
    id: "keepers",
    category: "Keeper Rewards Pool",
    percentage: 12,
    amountMillion: 12,
    color: "#F59E0B",
    cliffMonths: 0,
    vestingMonths: 48,
  },
  {
    id: "ecosystem",
    category: "Ecosystem Growth",
    percentage: 8,
    amountMillion: 8,
    color: "#EC4899",
    cliffMonths: 0,
    vestingMonths: 24,
  },
];

const MILESTONES: VestingMilestone[] = [
  {
    month: 0,
    label: "TGE Launch",
    communityUnlockedPct: 10,
    teamUnlockedPct: 0,
    stakersPoolPct: 5,
    keepersPoolPct: 5,
    circulatingSupplyMillion: 15.0,
  },
  {
    month: 6,
    label: "Team Cliff End",
    communityUnlockedPct: 25,
    teamUnlockedPct: 15,
    stakersPoolPct: 15,
    keepersPoolPct: 15,
    circulatingSupplyMillion: 28.5,
  },
  {
    month: 12,
    label: "Year 1 Expansion",
    communityUnlockedPct: 45,
    teamUnlockedPct: 35,
    stakersPoolPct: 30,
    keepersPoolPct: 30,
    circulatingSupplyMillion: 46.0,
  },
  {
    month: 24,
    label: "Year 2 Maturity",
    communityUnlockedPct: 75,
    teamUnlockedPct: 65,
    stakersPoolPct: 60,
    keepersPoolPct: 60,
    circulatingSupplyMillion: 73.0,
  },
  {
    month: 36,
    label: "Team Fully Vested",
    communityUnlockedPct: 100,
    teamUnlockedPct: 100,
    stakersPoolPct: 85,
    keepersPoolPct: 85,
    circulatingSupplyMillion: 91.5,
  },
  {
    month: 48,
    label: "Full Protocol Circulation",
    communityUnlockedPct: 100,
    teamUnlockedPct: 100,
    stakersPoolPct: 100,
    keepersPoolPct: 100,
    circulatingSupplyMillion: 100.0,
  },
];

const QUICK_LOCKUP_DAYS = [30, 90, 365] as const;

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3.5">
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1 ${color}`}
      >
        {icon} {label}
      </div>
      <div className="text-base font-bold font-mono text-white mt-1">
        {value}
      </div>
    </div>
  );
}

export default function TokenomicsPage() {
  const [currentMonth, setCurrentMonth] = useState<number>(12);
  const [claimModalOpen, setClaimModalOpen] = useState<boolean>(false);
  const [stakeAmount, setStakeAmount] = useState<string>("");

  const wallet = useWalletOptional();
  const vault = useStakingVault();

  const walletAddress = wallet?.session?.address ?? null;

  // Recalculate circulating supply & unlocked pools based on current slider month (0-48)
  const simulationMetrics = useMemo(() => {
    const month = currentMonth;

    // Team vesting (6-month cliff, 36-month linear duration)
    const teamUnlockedRatio = month < 6 ? 0 : Math.min(1, (month - 6) / 36);
    const teamUnlockedMillion = 20 * teamUnlockedRatio;

    // Staking emissions (48-month linear emission curve)
    const stakingUnlockedMillion = 25 * Math.min(1, month / 48);

    // Keeper rewards pool (48-month linear emission)
    const keepersUnlockedMillion = 12 * Math.min(1, month / 48);

    // Community treasury (36-month linear unlock)
    const treasuryUnlockedMillion = 35 * Math.min(1, month / 36);

    // Ecosystem (24-month linear unlock)
    const ecosystemUnlockedMillion = 8 * Math.min(1, month / 24);

    const circulatingSupply =
      teamUnlockedMillion +
      stakingUnlockedMillion +
      keepersUnlockedMillion +
      treasuryUnlockedMillion +
      ecosystemUnlockedMillion;

    return {
      month,
      circulatingSupply: Number(circulatingSupply.toFixed(2)),
      teamUnlockedPct: Math.round(teamUnlockedRatio * 100),
      stakingPoolMillion: Number(stakingUnlockedMillion.toFixed(2)),
      keeperRewardsMillion: Number(keepersUnlockedMillion.toFixed(2)),
      treasuryMillion: Number(treasuryUnlockedMillion.toFixed(2)),
    };
  }, [currentMonth]);

  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(16,185,129,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Navigation Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                SoroTask Tokenomics Engine
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Tokenomics & Vesting Simulator
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <FiActivity className="animate-pulse" /> Live Vesting Calculations
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <FiDatabase /> 48-Month Horizon
            </span>
          </div>
        </header>

        {/* 48-Month Time-Slider Vesting Control Panel */}
        <section className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6 backdrop-blur-md shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FiSliders className="text-emerald-400" /> Vesting Time Slider
                (0 – 48 Months)
              </h2>
              <p className="text-xs text-slate-400">
                Drag the time slider to dynamically simulate token circulation,
                keeper reward emissions, and staker yields.
              </p>
            </div>
            <div className="flex items-center gap-4 font-mono">
              <div className="bg-slate-950 px-4 py-2 rounded-xl border border-white/10 text-right">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">
                  Active Timeline
                </div>
                <div className="text-lg font-black text-emerald-400">
                  Month {currentMonth}
                </div>
              </div>
              <div className="bg-slate-950 px-4 py-2 rounded-xl border border-white/10 text-right">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">
                  Circulating Supply
                </div>
                <div className="text-lg font-black text-white">
                  {simulationMetrics.circulatingSupply}M / 100M
                </div>
              </div>
            </div>
          </div>

          {/* Slider input */}
          <div className="space-y-2">
            <input
              type="range"
              min="0"
              max="48"
              step="1"
              value={currentMonth}
              onChange={(e) => setCurrentMonth(Number(e.target.value))}
              className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 focus:outline-none"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>Month 0 (TGE)</span>
              <span>Month 12 (Year 1)</span>
              <span>Month 24 (Year 2)</span>
              <span>Month 36 (Year 3)</span>
              <span>Month 48 (Full Unlock)</span>
            </div>
          </div>

          {/* Dynamic Metrics Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">
                Staking Emissions Pool
              </div>
              <div className="text-base font-bold font-mono text-emerald-400">
                {simulationMetrics.stakingPoolMillion}M Tokens
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">
                Keeper Rewards Pool
              </div>
              <div className="text-base font-bold font-mono text-amber-400">
                {simulationMetrics.keeperRewardsMillion}M Tokens
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">
                Team Unlocked
              </div>
              <div className="text-base font-bold font-mono text-purple-400">
                {simulationMetrics.teamUnlockedPct}% Vested
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">
                Treasury Unlocked
              </div>
              <div className="text-base font-bold font-mono text-blue-400">
                {simulationMetrics.treasuryMillion}M Tokens
              </div>
            </div>
          </div>
        </section>

        {/* Staking Vault — Dynamic APR Section */}
        <section
          aria-labelledby="staking-vault-heading"
          className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6 backdrop-blur-md shadow-2xl space-y-5"
        >
          <div>
            <h2
              id="staking-vault-heading"
              className="text-lg font-bold text-white flex items-center gap-2"
            >
              <MdAccountBalanceWallet className="text-emerald-400" /> Staking
              Vault — Dynamic APR
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Deposit XLM to earn protocol emissions. Base APR derives from
              vault contract state; the lockup multiplier boosts it across 30d,
              90d and 365d.
            </p>
            {vault.isSimulated && (
              <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold text-amber-300">
                <FiClock /> Simulated vault state (contract not yet deployed)
              </span>
            )}
          </div>

          {/* Metrics grid */}
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Base APR (Contract)"
              icon={<FiTrendingUp className="size-4" />}
              color="text-emerald-400"
              value={`${formatStakingNumber(vault.baseApr, 4)}%`}
            />
            <MetricCard
              label="Lockup Multiplier"
              icon={<FiShield className="size-4" />}
              color="text-emerald-400"
              value={`${vault.multiplier.toFixed(2)}x`}
            />
            <MetricCard
              label="Dynamic APR"
              icon={<FiActivity className="size-4" />}
              color="text-emerald-400"
              value={`${formatStakingNumber(vault.dynamicApr, 4)}%`}
            />
            <MetricCard
              label="Projected Yield (30d)"
              icon={<FiTrendingUp className="size-4" />}
              color="text-white"
              value={`${formatStakingNumber(vault.projectedYieldXlm)} XLM`}
            />
            <MetricCard
              label="Staked Balance"
              icon={<MdAccountBalanceWallet className="size-4" />}
              color="text-white"
              value={`${formatStakingNumber(vault.stakedXlm)} XLM`}
            />
            <MetricCard
              label="Claimable Rewards"
              icon={<FiClock className="size-4" />}
              color="text-white"
              value={`${formatStakingNumber(vault.claimableXlm)} XLM`}
            />
          </div>

          {/* Wallet status */}
          <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Wallet Status
            </div>
            {vault.isConnected && walletAddress ? (
              <div
                className="font-mono text-sm font-semibold text-emerald-400"
                data-testid="connected-address"
              >
                Connected: {walletAddress.slice(0, 12)}…
                {walletAddress.slice(-8)}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">
                  Wallet not connected — staking inactive, no rewards accrue.
                </span>
                <button
                  type="button"
                  onClick={() => wallet.openConnectModal()}
                  className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition"
                >
                  Connect Wallet
                </button>
              </div>
            )}
          </div>

          {/* Interactive Lockup Slider */}
          <div className="space-y-3 rounded-xl border border-white/5 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <label
                  htmlFor="lockup-duration-slider"
                  className="text-sm font-semibold text-slate-300"
                >
                  Lockup Duration (1–365 days)
                </label>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Longer lockups raise your multiplier and projected yield.
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400 font-semibold">
                  Multiplier
                </div>
                <div className="font-mono font-bold text-emerald-400">
                  {vault.multiplier.toFixed(2)}x
                </div>
              </div>
            </div>

            <input
              id="lockup-duration-slider"
              type="range"
              min={1}
              max={365}
              step={1}
              value={vault.lockupDays}
              aria-label="Lockup duration in days"
              aria-valuemin={1}
              aria-valuemax={365}
              aria-valuenow={vault.lockupDays}
              aria-valuetext={`${vault.lockupDays} days`}
              onChange={(e) => vault.setLockupDays(Number(e.target.value))}
              className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 focus:outline-none"
            />
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>1 day</span>
              <span>30 days</span>
              <span>90 days</span>
              <span>365 days</span>
            </div>

            <div role="group" aria-label="Quick lockup presets">
              <div className="flex flex-wrap gap-2">
                {QUICK_LOCKUP_DAYS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => vault.setLockupDays(days)}
                    aria-pressed={vault.lockupDays === days}
                    data-testid={`lockup-preset-${days}d`}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      vault.lockupDays === days
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                        : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview of multiplier & projected yield */}
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Live Preview
              </div>
              <div className="text-sm font-bold font-mono text-white">
                Projected yield: {formatStakingNumber(vault.projectedYieldXlm)}{" "}
                XLM
                <span className="text-[10px] font-sans font-normal text-slate-400 ml-2">
                  over {vault.lockupDays}d lockup at{" "}
                  {formatStakingNumber(vault.dynamicApr, 4)}% APR
                </span>
              </div>
              {vault.stakeError && (
                <div role="alert" className="mt-2 text-[10px] text-red-400">
                  {vault.stakeError}
                </div>
              )}
            </div>
          </div>

          {/* Stake form */}
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="relative flex-1 max-w-xs">
              <label
                htmlFor="vault-stake-amount"
                className="text-[10px] text-slate-400 uppercase tracking-wider"
              >
                Stake Amount (XLM)
              </label>
              <input
                id="vault-stake-amount"
                type="number"
                min="0"
                step="any"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="Enter amount"
                disabled={!vault.isConnected}
                aria-label="Stake amount in XLM"
                data-testid="vault-stake-amount"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none disabled:opacity-40"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                void vault.stake(Number(stakeAmount));
                setStakeAmount("");
              }}
              disabled={
                vault.isStaking ||
                !vault.isConnected ||
                Number(stakeAmount) <= 0
              }
              data-testid="vault-stake-button"
              className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition"
            >
              {vault.isStaking ? "Staking…" : "Stake"}
            </button>
          </div>

          {/* 1-Click Claim / Compound actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setClaimModalOpen(true)}
              disabled={!vault.isConnected}
              data-testid="claim-rewards-button"
              className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              Claim Rewards ({formatStakingNumber(vault.claimableXlm)})
            </button>
            <button
              type="button"
              onClick={() => void vault.compoundStake()}
              disabled={!vault.isConnected || vault.isCompounding}
              data-testid="compound-button"
              className="rounded-xl border border-purple-500/50 bg-purple-500/10 px-5 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 transition"
            >
              {vault.isCompounding ? "Compounding…" : "1-Click Compound"}
            </button>
            {vault.compoundError && (
              <span
                role="alert"
                className="text-[10px] text-red-400 font-mono break-all"
              >
                {vault.compoundError}
              </span>
            )}
            {vault.lastTxHash && (
              <span className="text-[10px] font-mono text-slate-400">
                {vault.lastTxHash}
              </span>
            )}
          </div>

          {/* Unstaking Timelock Tracker */}
          <UnstakingTimelockTracker unstakes={vault.activeUnstakes} />
        </section>

        {/* Reward Claim Modal */}
        <RewardClaimModal
          isOpen={claimModalOpen}
          onClose={() => setClaimModalOpen(false)}
          onCompound={() => void vault.compoundStake()}
          compoundProjectionXlm={vault.compoundProjection}
        />

        {/* Grid: Pie Chart & Sankey Diagram */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <TokenomicsPieChart
              allocations={INITIAL_ALLOCATIONS}
              totalTokenSupply={100}
            />
          </div>
          <div className="lg:col-span-2">
            <SankeyDiagram width={780} height={460} />
          </div>
        </div>

        {/* Vesting Milestone Table */}
        <VestingScheduleTable
          currentMonth={currentMonth}
          milestones={MILESTONES}
        />
      </div>
    </main>
  );
}

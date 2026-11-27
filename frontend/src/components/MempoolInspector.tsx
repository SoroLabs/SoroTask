"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowDown,
  FiArrowUp,
  FiBox,
  FiClock,
  FiCpu,
  FiFilter,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiShield,
  FiUser,
  FiZap,
} from "react-icons/fi";

export type GasPriority = "high" | "normal" | "low";
export type TransactionStatus = "pending" | "included" | "replaced";
export type MevRisk = "low" | "medium" | "high";
export type AlertSeverity = "critical" | "high" | "medium";

export interface MempoolTransaction {
  id?: string;
  hash: string;
  sender: string;
  targetContract: string;
  functionName: string;
  feeXlm: number;
  baseFeeStroops: number;
  estimatedCompute: number;
  gasPriority: GasPriority;
  timestamp: number;
  isUserTx: boolean;
  status: TransactionStatus;
  estimatedConfirmationSec: number;
  action?: "swap" | "transfer" | "other";
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  slippageTolerance?: number;
  minAmountOut?: number;
}

export interface MempoolBlock {
  id?: string;
  number: number;
  timestamp: number;
  fillPercent: number;
  transactions: MempoolTransaction[];
  baseFeeXlm: number;
  priorityFeeXlm: number;
  mevRisk: MevRisk;
}

export interface SandwichAlert {
  id: string;
  severity: AlertSeverity;
  riskScore: number;
  contract: string;
  pair: string;
  victimTx: MempoolTransaction;
  frontRunTx?: MempoolTransaction;
  backRunTx?: MempoolTransaction;
  reason: string;
  recommendedSlippage: number;
}

export interface FeeSpread {
  min: number;
  max: number;
  average: number;
  spread: number;
}

export interface FeeHistogramBin {
  label: string;
  count: number;
  heightPercent: number;
  colorClass: string;
}

export interface MempoolInspectorProps {
  initialTransactions?: MempoolTransaction[];
  initialBlocks?: MempoolBlock[];
  autoStream?: boolean;
  streamIntervalMs?: number;
  maxRetained?: number;
  userAddress?: string;
  onSlippageAction?: (alert: SandwichAlert) => void;
}

const DEFAULT_USER_ADDRESS =
  "GBDEV111111111111111111111111111111111111111111111111111111";

const DEFAULT_MAX_RETAINED = 60;
const DEFAULT_STREAM_INTERVAL_MS = 750;
const MAX_BLOCKS = 6;
const SWAP_PATTERN = /swap|trade|exchange|liquidity/i;
const MEV_WINDOW_MS = 15_000;
const MIN_FEE_DELTA_XLM = 0.0005;

const SAMPLE_CONTRACTS = [
  { contract: "CA7...89Z", name: "Swap_Execute" },
  { contract: "CB2...11M", name: "Liquidity_Rebalance" },
  { contract: "CC9...44Q", name: "Yield_Harvester" },
  { contract: "CD5...77K", name: "Oracle_Push_Price" },
  { contract: "CE1...22P", name: "Limit_Order_Fill" },
];

const SAMPLE_PAIRS = [
  { tokenIn: "XLM", tokenOut: "USDC" },
  { tokenIn: "USDC", tokenOut: "XLM" },
  { tokenIn: "AQUA", tokenOut: "USDC" },
  { tokenIn: "XLM", tokenOut: "AQUA" },
];

let transactionSequence = 0;

function nextTransactionId(prefix = "tx"): string {
  transactionSequence += 1;
  return `${prefix}-${transactionSequence.toString(36)}-${Date.now().toString(36)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function transactionId(tx: MempoolTransaction): string {
  return tx.id ?? tx.hash;
}

export function isSwapTransaction(tx: MempoolTransaction): boolean {
  return (
    tx.action === "swap" ||
    SWAP_PATTERN.test(tx.functionName) ||
    Boolean(tx.tokenIn && tx.tokenOut)
  );
}

export function transactionPairKey(tx: MempoolTransaction): string {
  const pair =
    tx.tokenIn && tx.tokenOut ? `${tx.tokenIn}->${tx.tokenOut}` : "spot";
  return `${tx.targetContract}:${pair}`;
}

export function makeMempoolTransaction(
  input: Omit<
    MempoolTransaction,
    | "baseFeeStroops"
    | "gasPriority"
    | "estimatedCompute"
    | "estimatedConfirmationSec"
    | "status"
    | "id"
  > &
    Partial<MempoolTransaction> & { hash: string },
): MempoolTransaction {
  const feeXlm = input.feeXlm;
  return {
    id: input.id ?? input.hash,
    hash: input.hash,
    sender: input.sender,
    targetContract: input.targetContract,
    functionName: input.functionName,
    feeXlm,
    baseFeeStroops:
      input.baseFeeStroops ?? Math.max(0, Math.round(feeXlm * 10_000_000)),
    estimatedCompute: input.estimatedCompute ?? 250_000,
    gasPriority:
      input.gasPriority ??
      (feeXlm > 0.015 ? "high" : feeXlm > 0.006 ? "normal" : "low"),
    timestamp: input.timestamp,
    isUserTx: input.isUserTx ?? false,
    status: input.status ?? "pending",
    estimatedConfirmationSec:
      input.estimatedConfirmationSec ??
      (feeXlm > 0.015 ? 2 : feeXlm > 0.006 ? 6 : 12),
    action: input.action,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    slippageTolerance: input.slippageTolerance,
    minAmountOut: input.minAmountOut,
  };
}

function normalizeTransaction(tx: MempoolTransaction): MempoolTransaction {
  return makeMempoolTransaction(tx);
}

function normalizeInitialTransactions(
  transactions: readonly MempoolTransaction[],
  limit: number,
): MempoolTransaction[] {
  return [...transactions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(1, limit))
    .map(normalizeTransaction);
}

export function pushBounded<T>(
  current: readonly T[],
  incoming: T | readonly T[],
  max: number,
): T[] {
  const limit = Math.max(1, Math.floor(max));
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  if (additions.length === 0) {
    return current.slice(0, limit);
  }
  return [...additions, ...current].slice(0, limit);
}

export function computeFeeSpread(
  transactions: readonly MempoolTransaction[],
): FeeSpread {
  if (transactions.length === 0) {
    return { min: 0, max: 0, average: 0, spread: 0 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let total = 0;

  for (const tx of transactions) {
    const fee = Number.isFinite(tx.feeXlm) ? tx.feeXlm : 0;
    min = Math.min(min, fee);
    max = Math.max(max, fee);
    total += fee;
  }

  min = Number.isFinite(min) ? min : 0;
  return {
    min,
    max,
    average: total / transactions.length,
    spread: max - min,
  };
}

export function buildFeeHistogram(
  transactions: readonly MempoolTransaction[],
): FeeHistogramBin[] {
  const bins: Array<Omit<FeeHistogramBin, "heightPercent">> = [
    { label: "< 0.005 XLM", count: 0, colorClass: "bg-slate-600" },
    { label: "0.005 - 0.010", count: 0, colorClass: "bg-indigo-500" },
    { label: "0.010 - 0.015", count: 0, colorClass: "bg-cyan-400" },
    { label: "0.015 - 0.020", count: 0, colorClass: "bg-emerald-400" },
    { label: "> 0.020 XLM", count: 0, colorClass: "bg-purple-500" },
  ];

  for (const tx of transactions) {
    if (tx.feeXlm < 0.005) bins[0].count += 1;
    else if (tx.feeXlm < 0.01) bins[1].count += 1;
    else if (tx.feeXlm < 0.015) bins[2].count += 1;
    else if (tx.feeXlm < 0.02) bins[3].count += 1;
    else bins[4].count += 1;
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  return bins.map((bin) => ({
    ...bin,
    heightPercent: Math.round((bin.count / maxCount) * 100),
  }));
}

function severityFor(hasFront: boolean, hasBack: boolean): AlertSeverity {
  if (hasFront && hasBack) return "critical";
  if (hasFront) return "high";
  return "medium";
}

function riskScoreFor(
  victim: MempoolTransaction,
  front?: MempoolTransaction,
  back?: MempoolTransaction,
): number {
  const base = front && back ? 82 : front ? 66 : 44;
  const reference = Math.max(front?.feeXlm ?? 0, back?.feeXlm ?? 0);
  const deltaRatio =
    victim.feeXlm > 0
      ? Math.max(0, reference - victim.feeXlm) / victim.feeXlm
      : 0;
  return Math.round(clamp(base + deltaRatio * 12, 0, 99));
}

function recommendedSlippageFor(victim: MempoolTransaction): number {
  const current = victim.slippageTolerance ?? 1;
  if (current <= 0.1) return 0.1;
  const tightened = Math.min(current * 0.5, current - 0.1);
  return Math.round(Math.max(0.1, tightened) * 100) / 100;
}

export interface SandwichDetectionOptions {
  windowMs?: number;
  minFeeDeltaXlm?: number;
}

/**
 * Heuristic sandwich / front-running detector.
 *
 * A victim is any swap transaction authored by the user (or one that declares
 * an explicit slippage tolerance). We look for higher-fee swaps on the same
 * contract + token pair that bracket the victim inside a short time window.
 */
export function detectSandwichAttacks(
  transactions: readonly MempoolTransaction[],
  options: SandwichDetectionOptions = {},
): SandwichAlert[] {
  const windowMs = options.windowMs ?? MEV_WINDOW_MS;
  const minFeeDelta = options.minFeeDeltaXlm ?? MIN_FEE_DELTA_XLM;
  const swaps = transactions.filter(isSwapTransaction);
  if (swaps.length < 2) return [];

  const victims = swaps.filter(
    (tx) => tx.isUserTx || tx.slippageTolerance !== undefined,
  );
  const alerts: SandwichAlert[] = [];
  const seen = new Set<string>();

  for (const victim of victims) {
    const pairKey = transactionPairKey(victim);
    const competitors = swaps.filter((tx) => {
      if (transactionId(tx) === transactionId(victim)) return false;
      if (transactionPairKey(tx) !== pairKey) return false;
      if (tx.sender === victim.sender) return false;
      return Math.abs(tx.timestamp - victim.timestamp) <= windowMs;
    });

    const frontCandidates = competitors.filter(
      (tx) =>
        tx.timestamp <= victim.timestamp &&
        tx.feeXlm > victim.feeXlm + minFeeDelta,
    );
    const backCandidates = competitors.filter(
      (tx) =>
        tx.timestamp >= victim.timestamp &&
        tx.feeXlm >= victim.feeXlm &&
        !frontCandidates.includes(tx),
    );

    const frontRunTx = frontCandidates.sort((a, b) => b.feeXlm - a.feeXlm)[0];
    const backRunTx = backCandidates.sort((a, b) => b.feeXlm - a.feeXlm)[0];

    if (!frontRunTx && !backRunTx) continue;

    const id = [
      transactionId(victim),
      frontRunTx ? transactionId(frontRunTx) : "no-front",
      backRunTx ? transactionId(backRunTx) : "no-back",
    ].join("|");

    if (seen.has(id)) continue;
    seen.add(id);

    const hasFront = Boolean(frontRunTx);
    const hasBack = Boolean(backRunTx);
    const severity = severityFor(hasFront, hasBack);
    const reason =
      hasFront && hasBack
        ? `Higher-fee swaps bracket your transaction on ${pairKey}.`
        : hasFront
          ? `A higher-fee swap is queued ahead of your transaction on ${pairKey}.`
          : `A same-pair swap is queued behind your transaction on ${pairKey}.`;

    alerts.push({
      id,
      severity,
      riskScore: riskScoreFor(victim, frontRunTx, backRunTx),
      contract: victim.targetContract,
      pair: pairKey,
      victimTx: victim,
      frontRunTx,
      backRunTx,
      reason,
      recommendedSlippage: recommendedSlippageFor(victim),
    });
  }

  return alerts.sort((a, b) => b.riskScore - a.riskScore);
}

export function computeBlockMevRisk(
  transactions: readonly MempoolTransaction[],
): MevRisk {
  const swaps = transactions.filter(isSwapTransaction);
  if (swaps.length === 0) return "low";

  const groups = new Map<string, number>();
  let total = 0;
  let maxFee = 0;

  for (const tx of swaps) {
    const key = transactionPairKey(tx);
    groups.set(key, (groups.get(key) ?? 0) + 1);
    total += tx.feeXlm;
    maxFee = Math.max(maxFee, tx.feeXlm);
  }

  const maxGroup = Math.max(...groups.values());
  const average = total / swaps.length;
  const hasAggressiveBid = average > 0 && maxFee > average * 1.8;

  if (maxGroup >= 2 && hasAggressiveBid) return "high";
  if (maxGroup >= 2 || hasAggressiveBid) return "medium";
  return "low";
}

export function buildMempoolBlock(
  number: number,
  transactions: readonly MempoolTransaction[],
  fillPercent: number,
  timestamp: number = Date.now(),
): MempoolBlock {
  const txs = [...transactions];
  const spread = computeFeeSpread(txs);
  return {
    id: `block-${number}`,
    number,
    timestamp,
    fillPercent: Math.round(clamp(fillPercent, 1, 100)),
    transactions: txs,
    baseFeeXlm: spread.min,
    priorityFeeXlm: spread.max,
    mevRisk: computeBlockMevRisk(txs),
  };
}

function createRandomTransaction(userAddress: string): MempoolTransaction {
  const isUser = Math.random() < 0.1;
  const isSwap = Math.random() < 0.55;
  const fee = Number((0.002 + Math.random() * 0.025).toFixed(5));
  const sample =
    SAMPLE_CONTRACTS[Math.floor(Math.random() * SAMPLE_CONTRACTS.length)];
  const pair = SAMPLE_PAIRS[Math.floor(Math.random() * SAMPLE_PAIRS.length)];

  return makeMempoolTransaction({
    id: nextTransactionId("stream"),
    hash: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random()
      .toString(16)
      .slice(2, 6)}`,
    sender: isUser
      ? userAddress
      : `G${Math.random().toString(36).slice(2, 8).toUpperCase()}...${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`,
    targetContract: sample.contract,
    functionName: isSwap ? "Swap_Execute" : sample.name,
    feeXlm: fee,
    timestamp: Date.now(),
    isUserTx: isUser,
    action: isSwap ? "swap" : "other",
    tokenIn: isSwap ? pair.tokenIn : undefined,
    tokenOut: isSwap ? pair.tokenOut : undefined,
    amountIn: isSwap ? Math.round(50 + Math.random() * 950) : undefined,
    slippageTolerance: isUser && isSwap ? 1 : undefined,
  });
}

function buildDemoSeed(userAddress: string): MempoolTransaction[] {
  const now = Date.now();
  const pair = SAMPLE_PAIRS[0];
  const contract = SAMPLE_CONTRACTS[0].contract;
  const attacker = "GSANDWICH...4F2A";

  const seeded: MempoolTransaction[] = [
    makeMempoolTransaction({
      id: "demo-front-run",
      hash: "0xsandwich...front",
      sender: attacker,
      targetContract: contract,
      functionName: "Swap_Execute",
      feeXlm: 0.046,
      timestamp: now - 5_000,
      isUserTx: false,
      action: "swap",
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn: 480,
      slippageTolerance: 0.5,
    }),
    makeMempoolTransaction({
      id: "demo-victim",
      hash: "0xuser...swap1743",
      sender: userAddress,
      targetContract: contract,
      functionName: "Swap_Execute",
      feeXlm: 0.012,
      timestamp: now - 3_000,
      isUserTx: true,
      action: "swap",
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn: 320,
      slippageTolerance: 2,
    }),
    makeMempoolTransaction({
      id: "demo-back-run",
      hash: "0xsandwich...back",
      sender: attacker,
      targetContract: contract,
      functionName: "Swap_Execute",
      feeXlm: 0.051,
      timestamp: now - 1_000,
      isUserTx: false,
      action: "swap",
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn: 475,
      slippageTolerance: 0.5,
    }),
  ];

  while (seeded.length < 16) {
    seeded.push(createRandomTransaction(userAddress));
  }

  return seeded
    .map(normalizeTransaction)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function createBlocksFromTransactions(
  transactions: readonly MempoolTransaction[],
  baseNumber = 52_194_820,
): MempoolBlock[] {
  const sorted = [...transactions].sort((a, b) => b.timestamp - a.timestamp);
  const blocks: MempoolBlock[] = [];

  for (let index = 0; index < 3; index += 1) {
    const chunk = sorted.slice(index * 5, index * 5 + 5);
    blocks.push(
      buildMempoolBlock(
        baseNumber - index,
        chunk,
        clamp(38 + chunk.length * 9, 15, 96),
        Date.now() - index * 5_000,
      ),
    );
  }

  return blocks;
}

export function formatFee(fee: number): string {
  if (!Number.isFinite(fee)) return "0 XLM";
  const rounded = Math.round(fee * 100_000) / 100_000;
  return `${rounded} XLM`;
}

function formatAge(timestamp: number, now: number = Date.now()): string {
  const ageSeconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (ageSeconds < 1) return "now";
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  return `${Math.round(ageSeconds / 60)}m ago`;
}

function priorityLabel(priority: GasPriority): string {
  switch (priority) {
    case "high":
      return "High priority";
    case "normal":
      return "Normal priority";
    default:
      return "Low priority";
  }
}

function priorityColorClass(priority: GasPriority): string {
  switch (priority) {
    case "high":
      return "bg-fuchsia-400";
    case "normal":
      return "bg-cyan-400";
    default:
      return "bg-slate-500";
  }
}

function mevRiskLabel(risk: MevRisk): string {
  switch (risk) {
    case "high":
      return "High MEV risk";
    case "medium":
      return "Medium MEV risk";
    default:
      return "Low MEV risk";
  }
}

function mevRiskClass(risk: MevRisk): string {
  switch (risk) {
    case "high":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    default:
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
}

function severityClass(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "border-rose-500/50 bg-rose-950/40 text-rose-100";
    case "high":
      return "border-amber-500/50 bg-amber-950/30 text-amber-100";
    default:
      return "border-yellow-500/40 bg-yellow-950/20 text-yellow-100";
  }
}

function getSafeCanvasContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  try {
    if (typeof canvas.getContext !== "function") return null;
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

function drawMempoolField(
  canvas: HTMLCanvasElement,
  transactions: readonly MempoolTransaction[],
  alertTxIds: ReadonlySet<string>,
  time: number,
): void {
  const ctx = getSafeCanvasContext(canvas);
  if (!ctx) return;

  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 180;
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;

  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
  }
  if (canvas.height !== Math.round(height * dpr)) {
    canvas.height = Math.round(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(15, 23, 42, 0.9)");
  gradient.addColorStop(1, "rgba(2, 6, 23, 0.95)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(99, 102, 241, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (transactions.length === 0) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("Waiting for mempool transactions...", 16, height / 2);
    return;
  }

  const maxFee = Math.max(...transactions.map((tx) => tx.feeXlm), 0.001);
  const slotWidth = width / Math.max(transactions.length, 1);
  const barWidth = Math.max(3, slotWidth - 3);
  const pulse = 0.65 + Math.sin(time / 420) * 0.35;

  transactions.forEach((tx, index) => {
    const x = index * slotWidth + (slotWidth - barWidth) / 2;
    const barHeight = clamp(
      (tx.feeXlm / maxFee) * (height - 34),
      6,
      height - 34,
    );
    const y = height - barHeight - 10;

    if (tx.isUserTx) {
      ctx.fillStyle = `rgba(192, 132, 252, ${0.35 + pulse * 0.25})`;
    } else if (alertTxIds.has(transactionId(tx))) {
      ctx.fillStyle = "rgba(248, 113, 113, 0.9)";
    } else if (tx.gasPriority === "high") {
      ctx.fillStyle = "rgba(232, 121, 249, 0.85)";
    } else if (tx.gasPriority === "normal") {
      ctx.fillStyle = "rgba(34, 211, 238, 0.75)";
    } else {
      ctx.fillStyle = "rgba(100, 116, 139, 0.75)";
    }

    ctx.fillRect(x, y, barWidth, barHeight);

    if (tx.isUserTx) {
      ctx.strokeStyle = "rgba(216, 180, 254, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, barWidth, barHeight);
    }

    if (alertTxIds.has(transactionId(tx))) {
      ctx.fillStyle = "rgba(248, 113, 113, 1)";
      ctx.beginPath();
      ctx.arc(x + barWidth / 2, Math.max(8, y - 6), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export function MempoolInspector({
  initialTransactions,
  initialBlocks,
  autoStream = true,
  streamIntervalMs = DEFAULT_STREAM_INTERVAL_MS,
  maxRetained = DEFAULT_MAX_RETAINED,
  userAddress = DEFAULT_USER_ADDRESS,
  onSlippageAction,
}: MempoolInspectorProps) {
  const retainedLimit = Math.max(1, Math.floor(maxRetained));
  const retainedLimitRef = useRef(retainedLimit);
  const seededRef = useRef(false);
  const pendingRef = useRef<MempoolTransaction[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const [transactions, setTransactions] = useState<MempoolTransaction[]>(() =>
    normalizeInitialTransactions(initialTransactions ?? [], retainedLimit),
  );
  const [blocks, setBlocks] = useState<MempoolBlock[]>(() =>
    (initialBlocks ?? []).slice(0, MAX_BLOCKS).map((block) => ({
      ...block,
      id: block.id ?? `block-${block.number}`,
      transactions: block.transactions.map(normalizeTransaction),
    })),
  );
  const [isLiveStreaming, setIsLiveStreaming] = useState(autoStream);
  const [filterUserOnly, setFilterUserOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"fee" | "time" | "compute">("fee");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    retainedLimitRef.current = retainedLimit;
  }, [retainedLimit]);

  // Seed demo data once when the caller did not provide a stream snapshot.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const provided =
      initialTransactions && initialTransactions.length > 0
        ? normalizeInitialTransactions(initialTransactions, retainedLimit)
        : null;

    if (provided) {
      if (!initialBlocks || initialBlocks.length === 0) {
        startTransition(() =>
          setBlocks(createBlocksFromTransactions(provided)),
        );
      }
      return;
    }

    if (initialBlocks && initialBlocks.length > 0) return;

    const seed = buildDemoSeed(userAddress)
      .slice(0, retainedLimit)
      .map(normalizeTransaction);
    startTransition(() => {
      setTransactions(seed);
      setBlocks(createBlocksFromTransactions(seed));
    });
  }, [initialTransactions, initialBlocks, retainedLimit, userAddress]);

  const flushPending = useCallback(() => {
    flushTimerRef.current = null;
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setTransactions((prev) =>
      pushBounded(prev, batch, retainedLimitRef.current),
    );
  }, []);

  const enqueueTransactions = useCallback(
    (incoming: MempoolTransaction | MempoolTransaction[]) => {
      const list = Array.isArray(incoming) ? incoming : [incoming];
      if (list.length === 0) return;
      pendingRef.current.push(...list);

      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flushPending, 120);
      }
    },
    [flushPending],
  );

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    },
    [enqueueTransactions],
  );

  const applyBatchToBlocks = useCallback((batch: MempoolTransaction[]) => {
    setBlocks((prev) => {
      if (prev.length === 0) {
        return createBlocksFromTransactions(batch);
      }

      const [current, ...rest] = prev;
      const merged = pushBounded(
        current.transactions,
        batch,
        retainedLimitRef.current,
      );
      const fill = clamp(current.fillPercent + batch.length * 3, 1, 100);
      const updated = buildMempoolBlock(
        current.number,
        merged,
        fill,
        current.timestamp,
      );

      if (fill >= 95) {
        const next = buildMempoolBlock(current.number + 1, [], 5);
        return [next, updated, ...rest].slice(0, MAX_BLOCKS);
      }

      return [updated, ...rest].slice(0, MAX_BLOCKS);
    });
  }, []);

  // Batched high-frequency stream ingestion.
  useEffect(() => {
    if (!autoStream || !isLiveStreaming) return;

    const interval = setInterval(
      () => {
        const burstSize = 1 + Math.floor(Math.random() * 3);
        const batch = Array.from({ length: burstSize }, () =>
          createRandomTransaction(userAddress),
        );
        enqueueTransactions(batch);
        applyBatchToBlocks(batch);
        setNow(Date.now());
      },
      Math.max(100, streamIntervalMs),
    );

    return () => clearInterval(interval);
  }, [
    autoStream,
    isLiveStreaming,
    streamIntervalMs,
    enqueueTransactions,
    applyBatchToBlocks,
    userAddress,
  ]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const sandwichAlerts = useMemo(
    () => detectSandwichAttacks(transactions),
    [transactions],
  );

  const alertTxIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of sandwichAlerts) {
      ids.add(transactionId(alert.victimTx));
      if (alert.frontRunTx) ids.add(transactionId(alert.frontRunTx));
      if (alert.backRunTx) ids.add(transactionId(alert.backRunTx));
    }
    return ids;
  }, [sandwichAlerts]);

  const displayTransactions = useMemo(() => {
    const list = filterUserOnly
      ? transactions.filter((tx) => tx.isUserTx)
      : transactions;

    return [...list].sort((a, b) => {
      let diff = 0;
      if (sortBy === "fee") diff = a.feeXlm - b.feeXlm;
      else if (sortBy === "time") diff = a.timestamp - b.timestamp;
      else diff = a.estimatedCompute - b.estimatedCompute;
      return diff * -1;
    });
  }, [transactions, filterUserOnly, sortBy]);

  const visibleTransactions = useMemo(
    () => displayTransactions.slice(0, retainedLimit),
    [displayTransactions, retainedLimit],
  );
  const feeHistogram = useMemo(
    () => buildFeeHistogram(transactions),
    [transactions],
  );
  const feeSpread = useMemo(
    () => computeFeeSpread(transactions),
    [transactions],
  );

  const selectedBlock = useMemo(
    () =>
      blocks.find(
        (block) => (block.id ?? `block-${block.number}`) === selectedBlockId,
      ) ?? null,
    [blocks, selectedBlockId],
  );
  const selectedTransaction = useMemo(
    () => transactions.find((tx) => transactionId(tx) === selectedTxId) ?? null,
    [transactions, selectedTxId],
  );
  const selectedTransactionAlert = useMemo(() => {
    if (!selectedTransaction) return null;
    return (
      sandwichAlerts.find(
        (alert) =>
          transactionId(alert.victimTx) === transactionId(selectedTransaction),
      ) ?? null
    );
  }, [selectedTransaction, sandwichAlerts]);

  const userPendingCount = transactions.filter(
    (tx) => tx.isUserTx && tx.status === "pending",
  ).length;
  const currentBlock = blocks[0];
  const blockFillPercent = currentBlock?.fillPercent ?? 0;
  const candidateBlockNumber = currentBlock?.number ?? 52_194_820;

  // Canvas renderer: guarded for jsdom / missing Canvas 2D support.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Avoid jsdom's "not implemented" canvas path; DOM fallback stays visible.
    if (process.env.NODE_ENV === "test") return;

    const ctx = getSafeCanvasContext(canvas);
    if (!ctx) return;

    const supportsRaf =
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function" &&
      typeof window.cancelAnimationFrame === "function";

    let cancelled = false;
    const render = (time: number) => {
      if (cancelled) return;
      drawMempoolField(canvas, visibleTransactions, alertTxIds, time);
      if (supportsRaf) {
        frameRef.current = window.requestAnimationFrame(render);
      }
    };

    render(0);

    return () => {
      cancelled = true;
      if (frameRef.current !== null && supportsRaf) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [visibleTransactions, alertTxIds]);

  const inspectBlock = useCallback((block: MempoolBlock) => {
    setSelectedBlockId(block.id ?? `block-${block.number}`);
    setSelectedTxId(null);
  }, []);

  const inspectTransaction = useCallback((tx: MempoolTransaction) => {
    setSelectedTxId(transactionId(tx));
  }, []);

  const handleSlippageAction = useCallback(
    (alert: SandwichAlert) => {
      onSlippageAction?.(alert);
      setSelectedTxId(transactionId(alert.victimTx));
    },
    [onSlippageAction],
  );

  const statusCounts = useMemo(() => {
    const pending = transactions.filter((tx) => tx.status === "pending").length;
    const included = transactions.filter(
      (tx) => tx.status === "included",
    ).length;
    return { pending, included };
  }, [transactions]);

  return (
    <div data-testid="mempool-inspector" className="space-y-6 text-slate-100">
      <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <FiBox className="size-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white">
                Live Mempool Visualizer &amp; MEV Monitor
              </h2>
              <span
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"
                data-testid="stream-status"
              >
                <span
                  className="size-2 rounded-full bg-emerald-400"
                  aria-hidden="true"
                />
                <span aria-live="polite">
                  {isLiveStreaming ? "Live sub-second stream" : "Stream paused"}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Tracking unconfirmed Soroban executions, priority fee competition,
              and sandwich attack risk.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsLiveStreaming((value) => !value)}
            aria-label={
              isLiveStreaming ? "Pause live stream" : "Resume live stream"
            }
            aria-pressed={isLiveStreaming}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              isLiveStreaming
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-800 text-slate-300"
            }`}
          >
            {isLiveStreaming ? (
              <FiPause className="size-3.5" aria-hidden="true" />
            ) : (
              <FiPlay className="size-3.5" aria-hidden="true" />
            )}
            {isLiveStreaming ? "Streaming Active" : "Stream Paused"}
          </button>

          <button
            type="button"
            onClick={() => {
              const tx = createRandomTransaction(userAddress);
              const swap = { ...tx, isUserTx: true, action: "swap" as const };
              enqueueTransactions(swap);
              applyBatchToBlocks([swap]);
            }}
            aria-label="Simulate incoming swap transaction"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-600/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600"
          >
            <FiZap className="size-3.5" aria-hidden="true" />
            Inject Swap
          </button>
        </div>
      </header>

      <section
        aria-label="MEV sandwich diagnostics"
        data-testid="mev-diagnostics"
        className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FiShield className="size-4 text-rose-400" aria-hidden="true" />
            <h3 className="text-base font-bold text-white">
              MEV Sandwich Diagnostics
            </h3>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
              sandwichAlerts.length > 0
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {sandwichAlerts.length > 0
              ? `${sandwichAlerts.length} active warning${
                  sandwichAlerts.length === 1 ? "" : "s"
                }`
              : "No sandwich patterns detected"}
          </span>
        </div>

        {sandwichAlerts.length === 0 ? (
          <p className="text-xs text-slate-400" role="status">
            No sandwich or front-running patterns detected across the current
            pending swap window.
          </p>
        ) : (
          <ul className="space-y-3">
            {sandwichAlerts.map((alert) => {
              const victimSlippage =
                alert.victimTx.slippageTolerance !== undefined
                  ? `${alert.victimTx.slippageTolerance}%`
                  : "unset";

              return (
                <li
                  key={alert.id}
                  role="alert"
                  data-testid={`mev-alert-${alert.id}`}
                  className={`rounded-xl border p-4 ${severityClass(alert.severity)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <FiAlertTriangle
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <strong className="text-sm font-bold">
                      Sandwich attack detected
                    </strong>
                    <span className="rounded border border-current/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                      {alert.severity} risk
                    </span>
                    <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-mono">
                      score {alert.riskScore}/100
                    </span>
                  </div>

                  <p className="mt-2 text-xs opacity-90">{alert.reason}</p>

                  <p className="mt-1 text-xs font-semibold">
                    Recommended action: tighten slippage tolerance from{" "}
                    <span className="font-mono">{victimSlippage}</span> to{" "}
                    <span className="font-mono">
                      {alert.recommendedSlippage}%
                    </span>{" "}
                    and review the impacted swap before signing.
                  </p>

                  <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                    <div className="rounded-lg bg-black/25 p-2">
                      <dt className="font-semibold uppercase tracking-wide opacity-70">
                        Front-run
                      </dt>
                      <dd className="mt-0.5 font-mono break-all">
                        {alert.frontRunTx
                          ? `${alert.frontRunTx.hash} @ ${formatFee(
                              alert.frontRunTx.feeXlm,
                            )}`
                          : "Not observed"}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-black/25 p-2">
                      <dt className="font-semibold uppercase tracking-wide opacity-70">
                        Victim swap
                      </dt>
                      <dd className="mt-0.5 font-mono break-all">
                        {alert.victimTx.hash} @{" "}
                        {formatFee(alert.victimTx.feeXlm)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-black/25 p-2">
                      <dt className="font-semibold uppercase tracking-wide opacity-70">
                        Back-run
                      </dt>
                      <dd className="mt-0.5 font-mono break-all">
                        {alert.backRunTx
                          ? `${alert.backRunTx.hash} @ ${formatFee(
                              alert.backRunTx.feeXlm,
                            )}`
                          : "Not observed"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => inspectTransaction(alert.victimTx)}
                      className="rounded-lg border border-current/40 bg-black/20 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-black/35"
                    >
                      Inspect impacted swap
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSlippageAction(alert)}
                      className="rounded-lg border border-current/40 bg-black/20 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-black/35"
                    >
                      Apply slippage guidance
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                Candidate Block Construction
              </span>
              <h3 className="text-base font-bold text-white">
                Block #{candidateBlockNumber.toLocaleString()}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Block capacity</span>
              <div className="font-mono text-sm font-bold text-white">
                {blockFillPercent}% full
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/20 to-slate-950/80 p-3">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Real-time mempool fee field. ${transactions.length} transactions tracked, ${sandwichAlerts.length} MEV warnings, fee spread ${formatFee(
                feeSpread.min,
              )} to ${formatFee(feeSpread.max)}.`}
              data-testid="mempool-canvas"
              className="h-44 w-full rounded-lg"
            />

            <div
              className="pointer-events-none absolute inset-3 flex items-end"
              aria-hidden="true"
            >
              <div className="w-full">
                <div className="mb-2 flex items-center justify-between text-[10px] font-mono text-indigo-200/80">
                  <span>Fee field</span>
                  <span>{transactions.length} txs retained</span>
                </div>
              </div>
            </div>
          </div>

          {/* Accessible DOM fallback / competing fee visualization */}
          <div
            className="mt-4 space-y-2"
            data-testid="competing-fee-bars"
            aria-label="Competing transaction priority fees"
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Competing priority fees</span>
              <span className="font-mono">
                spread {formatFee(feeSpread.min)} – {formatFee(feeSpread.max)}
              </span>
            </div>

            {visibleTransactions.slice(0, 8).map((tx) => {
              const id = transactionId(tx);
              const widthPercent = clamp(
                (tx.feeXlm / Math.max(feeSpread.max, 0.001)) * 100,
                3,
                100,
              );

              return (
                <div
                  key={`fee-${id}`}
                  data-testid={`fee-bar-${id}`}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span
                    className="w-28 shrink-0 truncate font-mono text-slate-400"
                    title={tx.hash}
                  >
                    {tx.hash}
                  </span>
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
                    role="img"
                    aria-label={`${tx.hash} priority fee ${formatFee(tx.feeXlm)}, ${priorityLabel(tx.gasPriority)}`}
                  >
                    <div
                      className={`h-full rounded-full ${priorityColorClass(tx.gasPriority)}`}
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono font-semibold text-emerald-300">
                    {formatFee(tx.feeXlm)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">Pending txs</span>
              <span
                className="block font-mono text-sm font-bold text-white"
                data-testid="pending-tx-count"
              >
                {statusCounts.pending}
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">Included txs</span>
              <span className="block font-mono text-sm font-bold text-white">
                {statusCounts.included}
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">
                Avg priority fee
              </span>
              <span className="block font-mono text-sm font-bold text-indigo-300">
                {formatFee(feeSpread.average)}
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">
                Your pending txs
              </span>
              <span className="block font-mono text-sm font-bold text-purple-300">
                {userPendingCount}
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Fee Density Histogram
            </span>
            <h3 className="mb-2 text-base font-bold text-white">
              Priority Gas Distribution
            </h3>
            <p className="mb-4 text-xs text-slate-400">
              Gas bid clusters show the thresholds competing transactions must
              beat.
            </p>

            <div className="flex h-36 items-end gap-2 border-b border-slate-800 pb-2">
              {feeHistogram.map((bin) => (
                <div
                  key={bin.label}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="font-mono text-[10px] text-slate-400">
                    {bin.count}
                  </span>
                  <div
                    className={`w-full rounded-t transition-all duration-300 ${bin.colorClass}`}
                    style={{ height: `${Math.max(12, bin.heightPercent)}%` }}
                    role="img"
                    aria-label={`${bin.label}: ${bin.count} transactions`}
                    title={`${bin.label}: ${bin.count} transactions`}
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 text-center text-[10px] text-slate-500">
            Higher bids skip ahead in candidate block ordering.
          </p>
        </section>
      </div>

      <section
        aria-label="Block inspector"
        className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl"
      >
        <div className="mb-3">
          <h3 className="text-base font-bold text-white">Candidate Blocks</h3>
          <p className="text-xs text-slate-400">
            Select a block with the keyboard or pointer to inspect ordering, fee
            spread, and MEV risk.
          </p>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Candidate block list">
          {blocks.map((block) => {
            const blockId = block.id ?? `block-${block.number}`;
            const isSelected = selectedBlockId === blockId;
            return (
              <li key={blockId}>
                <button
                  type="button"
                  onClick={() => inspectBlock(block)}
                  aria-pressed={isSelected}
                  aria-label={`Inspect block ${block.number}, ${block.transactions.length} transactions, ${block.fillPercent} percent full, ${mevRiskLabel(
                    block.mevRisk,
                  )}`}
                  data-testid={`block-button-${block.number}`}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                    isSelected
                      ? "border-indigo-400/60 bg-indigo-500/20 text-white"
                      : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-indigo-500/40 hover:text-white"
                  }`}
                >
                  <span className="block font-mono font-bold">
                    #{block.number.toLocaleString()}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {block.transactions.length} txs · {block.fillPercent}% full
                  </span>
                  <span className="mt-1 block text-[10px] font-semibold">
                    {mevRiskLabel(block.mevRisk)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-bold text-white">
                Unconfirmed Transaction Pool
              </h3>
              <p className="text-xs text-slate-400">
                Bounded to the newest {retainedLimit} entries for fast, smooth
                rendering under bursty stream load.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterUserOnly((value) => !value)}
                aria-pressed={filterUserOnly}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  filterUserOnly
                    ? "border-purple-500/40 bg-purple-500/20 text-purple-300"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                }`}
              >
                <FiUser className="size-3.5" aria-hidden="true" />
                My Transactions Only
              </button>

              <label className="sr-only" htmlFor="mempool-sort">
                Sort transactions by
              </label>
              <select
                id="mempool-sort"
                value={sortBy}
                onChange={(event) =>
                  setSortBy(event.target.value as "fee" | "time" | "compute")
                }
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <option value="fee">Sort by Gas Fee</option>
                <option value="time">Sort by Age</option>
                <option value="compute">Sort by Compute</option>
              </select>
            </div>
          </div>

          <ul
            className="space-y-2"
            aria-label={`Mempool transactions, showing ${visibleTransactions.length} of ${displayTransactions.length}`}
            data-testid="mempool-transaction-list"
          >
            {visibleTransactions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">
                No transactions match the current filter.
              </li>
            ) : (
              visibleTransactions.map((tx) => {
                const id = transactionId(tx);
                const isSelected = selectedTxId === id;
                const isFlagged = alertTxIds.has(id);

                return (
                  <li key={id} data-testid={`mempool-tx-${id}`}>
                    <button
                      type="button"
                      onClick={() => inspectTransaction(tx)}
                      aria-pressed={isSelected}
                      aria-label={`Inspect transaction ${tx.hash}, ${tx.functionName}, fee ${formatFee(
                        tx.feeXlm,
                      )}, ${priorityLabel(tx.gasPriority)}${
                        isFlagged ? ", flagged MEV risk" : ""
                      }`}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-indigo-400/60 bg-indigo-500/15"
                          : isFlagged
                            ? "border-rose-500/30 bg-rose-950/20 hover:border-rose-400/50"
                            : tx.isUserTx
                              ? "border-purple-500/30 bg-purple-950/20 hover:border-purple-400/50"
                              : "border-slate-800 bg-slate-800/40 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs font-semibold text-slate-100">
                          {tx.hash}
                          {tx.isUserTx && (
                            <span className="rounded bg-purple-500/20 px-1 font-sans text-[10px] font-semibold text-purple-300">
                              You
                            </span>
                          )}
                          {isFlagged && (
                            <span className="rounded bg-rose-500/20 px-1 font-sans text-[10px] font-semibold text-rose-300">
                              MEV flagged
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-300">
                          {formatFee(tx.feeXlm)}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400 sm:grid-cols-4">
                        <span className="truncate" title={tx.functionName}>
                          <FiCpu
                            className="mr-1 inline size-3 text-indigo-400"
                            aria-hidden="true"
                          />
                          {tx.functionName}
                        </span>
                        <span className="truncate" title={tx.sender}>
                          {tx.sender}
                        </span>
                        <span>
                          <FiActivity
                            className="mr-1 inline size-3 text-cyan-400"
                            aria-hidden="true"
                          />
                          {priorityLabel(tx.gasPriority)}
                        </span>
                        <span className="flex items-center gap-1">
                          <FiClock
                            className="size-3 text-slate-500"
                            aria-hidden="true"
                          />
                          {formatAge(tx.timestamp, now)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section
          aria-label="Inspector detail panel"
          data-testid="inspector-detail"
          className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl"
        >
          {selectedTransaction ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-white">
                  Transaction Inspector
                </h3>
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  {selectedTransaction.status.toUpperCase()}
                </span>
              </div>

              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                {selectedTransaction.hash}
              </p>

              <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Sender
                  </dt>
                  <dd className="break-all font-mono">
                    {selectedTransaction.sender}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Contract action
                  </dt>
                  <dd className="font-mono">
                    {selectedTransaction.functionName}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Priority fee
                  </dt>
                  <dd className="font-mono text-emerald-300">
                    {formatFee(selectedTransaction.feeXlm)}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Estimated compute
                  </dt>
                  <dd className="font-mono">
                    {selectedTransaction.estimatedCompute.toLocaleString()}{" "}
                    units
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Slippage tolerance
                  </dt>
                  <dd className="font-mono">
                    {selectedTransaction.slippageTolerance !== undefined
                      ? `${selectedTransaction.slippageTolerance}%`
                      : "not set"}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    MEV diagnosis
                  </dt>
                  <dd
                    className={
                      selectedTransactionAlert
                        ? "text-rose-300"
                        : "text-emerald-300"
                    }
                  >
                    {selectedTransactionAlert
                      ? `${selectedTransactionAlert.severity} sandwich risk`
                      : "No sandwich pattern for this transaction"}
                  </dd>
                </div>
              </dl>

              {selectedTransactionAlert && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-100"
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    <FiAlertTriangle className="size-4" aria-hidden="true" />
                    Sandwich exposure detected
                  </p>
                  <p className="mt-1">
                    Tighten slippage from{" "}
                    {selectedTransaction.slippageTolerance !== undefined
                      ? `${selectedTransaction.slippageTolerance}%`
                      : "unset"}{" "}
                    to {selectedTransactionAlert.recommendedSlippage}% before
                    signing this swap.
                  </p>
                </div>
              )}
            </div>
          ) : selectedBlock ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-white">
                  Block Inspector
                </h3>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mevRiskClass(
                    selectedBlock.mevRisk,
                  )}`}
                >
                  {mevRiskLabel(selectedBlock.mevRisk)}
                </span>
              </div>

              <p className="mt-1 font-mono text-xs text-slate-300">
                Block #{selectedBlock.number.toLocaleString()}
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Transactions
                  </dt>
                  <dd className="font-mono">
                    {selectedBlock.transactions.length}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Capacity
                  </dt>
                  <dd className="font-mono">
                    {selectedBlock.fillPercent}% full
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Base fee
                  </dt>
                  <dd className="font-mono">
                    {formatFee(selectedBlock.baseFeeXlm)}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-800/50 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                    Priority spread
                  </dt>
                  <dd className="font-mono">
                    {formatFee(selectedBlock.baseFeeXlm)} –{" "}
                    {formatFee(selectedBlock.priorityFeeXlm)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <FiArrowDown className="size-3.5" aria-hidden="true" />
                  Transaction ordering
                </h4>
                {selectedBlock.transactions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400">
                    This candidate block is empty.
                  </p>
                ) : (
                  <ol
                    className="space-y-1.5 text-xs"
                    aria-label="Block transaction ordering"
                  >
                    {selectedBlock.transactions.map((tx, index) => {
                      const id = transactionId(tx);
                      return (
                        <li
                          key={`${selectedBlock.number}-${id}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-slate-500">
                              {index + 1}.
                            </span>
                            <span className="truncate font-mono text-slate-300">
                              {tx.hash}
                            </span>
                            {alertTxIds.has(id) && (
                              <span className="shrink-0 rounded bg-rose-500/20 px-1 text-[9px] font-semibold text-rose-300">
                                MEV
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => inspectTransaction(tx)}
                            aria-label={`Inspect transaction ${tx.hash} in block ${selectedBlock.number}`}
                            className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:border-indigo-400/50 hover:text-white"
                          >
                            Inspect
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 p-6 text-center">
              <FiFilter className="size-6 text-slate-500" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-200">
                Inspect a block or transaction
              </h3>
              <p className="max-w-xs text-xs text-slate-400">
                Select a candidate block or a mempool transaction to inspect its
                ordering, gas/fee spread, and MEV risk diagnostics.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-4 py-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <FiRefreshCw className="size-3" aria-hidden="true" />
          Batched stream flush · bounded ring buffer ({retainedLimit} items)
        </span>
        <span className="flex items-center gap-1.5">
          <FiArrowUp className="size-3" aria-hidden="true" />
          {sandwichAlerts.length > 0
            ? `${sandwichAlerts.length} slippage advisory active`
            : "Slippage advisory clear"}
        </span>
      </footer>
    </div>
  );
}

export default MempoolInspector;

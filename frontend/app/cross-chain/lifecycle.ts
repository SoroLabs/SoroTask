import type { BridgeEvent, NetworkId } from "./types";

/**
 * Cross-chain message lifecycle model (Issue #1252).
 *
 * A cross-chain trigger is not one transaction, it is three systems in
 * sequence: the source chain commits, a relay carries the message, the
 * destination executes. The existing UI shows a per-chain status, which
 * answers "did Ethereum confirm?" but not "where is my message right now" —
 * and a user watching a task that has confirmed on the source and not yet
 * appeared on the destination cannot tell a healthy in-flight message from a
 * stuck one.
 *
 * Modelling the stages explicitly is what makes that distinguishable.
 */

export type LifecycleStageId =
  /** The triggering transaction on the source chain. */
  | "source_commit"
  /** Source chain finality — the relay will not act before this. */
  | "source_finality"
  /** The message picked up and carried by the relay network. */
  | "relay_transport"
  /** Execution of the message on Soroban. */
  | "destination_execution"
  /** Destination finality: the point the outcome cannot be reorged away. */
  | "destination_finality";

export type StageStatus = "pending" | "active" | "complete" | "failed" | "stalled";

export interface LifecycleStage {
  id: LifecycleStageId;
  label: string;
  description: string;
  /** Which network the stage happens on, for explorer links and badges. */
  network: "source" | "relay" | "destination";
  status: StageStatus;
  txHash?: string;
  enteredAt?: string;
  completedAt?: string;
  /** Present when the stage failed, for display next to the stage. */
  error?: string;
}

export const STAGE_ORDER: LifecycleStageId[] = [
  "source_commit",
  "source_finality",
  "relay_transport",
  "destination_execution",
  "destination_finality",
];

const STAGE_META: Record<
  LifecycleStageId,
  { label: string; description: string; network: LifecycleStage["network"] }
> = {
  source_commit: {
    label: "Source commit",
    description: "Trigger transaction submitted on the source chain.",
    network: "source",
  },
  source_finality: {
    label: "Source finality",
    description: "Enough confirmations for the relay to act on the message.",
    network: "source",
  },
  relay_transport: {
    label: "CCIP relay",
    description: "Message observed and carried by the relay network.",
    network: "relay",
  },
  destination_execution: {
    label: "Soroban execution",
    description: "Message delivered and executed on the destination contract.",
    network: "destination",
  },
  destination_finality: {
    label: "Destination finality",
    description: "Outcome settled and no longer reversible.",
    network: "destination",
  },
};

/**
 * How long a stage may sit active before it is treated as stalled rather than
 * merely slow.
 *
 * These are deliberately generous: calling a healthy message stuck is worse
 * than being slow to call a stuck one, because it sends the user to support
 * for something that would have resolved itself. Relay transport gets the
 * longest window because it is the stage with the least visibility and the
 * most variance.
 */
export const STAGE_STALL_THRESHOLD_MS: Record<LifecycleStageId, number> = {
  source_commit: 5 * 60_000,
  source_finality: 20 * 60_000,
  relay_transport: 45 * 60_000,
  destination_execution: 15 * 60_000,
  destination_finality: 20 * 60_000,
};

/** Explorer base URLs, keyed by the network ids the app already uses. */
const EXPLORER_BASE: Record<NetworkId, { tx: string; label: string }> = {
  soroban: { tx: "https://stellar.expert/explorer/testnet/tx/", label: "Stellar Expert" },
  ethereum: { tx: "https://etherscan.io/tx/", label: "Etherscan" },
  polygon: { tx: "https://polygonscan.com/tx/", label: "PolygonScan" },
  arbitrum: { tx: "https://arbiscan.io/tx/", label: "Arbiscan" },
  base: { tx: "https://basescan.org/tx/", label: "BaseScan" },
};

export interface ExplorerLink {
  url: string;
  label: string;
}

/**
 * Build an explorer link for a transaction on a given network.
 *
 * Returns null rather than a broken link for an unknown network or an empty
 * hash: a link that 404s is worse than no link, because the user assumes the
 * transaction is missing rather than the link being wrong.
 */
export function buildExplorerLink(
  network: NetworkId,
  txHash: string | undefined,
): ExplorerLink | null {
  if (!txHash || !txHash.trim()) return null;
  const base = EXPLORER_BASE[network];
  if (!base) return null;

  return {
    url: `${base.tx}${encodeURIComponent(txHash.trim())}`,
    label: base.label,
  };
}

/** Whether an active stage has been active long enough to call stalled. */
export function isStageStalled(
  stageId: LifecycleStageId,
  enteredAt: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!enteredAt) return false;
  const entered = new Date(enteredAt).getTime();
  if (!Number.isFinite(entered)) return false;
  return now - entered >= STAGE_STALL_THRESHOLD_MS[stageId];
}

/**
 * Derive the full lifecycle from the bridge events already recorded for a
 * task.
 *
 * Derived rather than stored so the tracker cannot drift from the event log
 * that produced it: there is one source of truth, and a stage shown as
 * complete is complete because an event says so.
 */
export function deriveLifecycle(
  events: BridgeEvent[],
  now: number = Date.now(),
): LifecycleStage[] {
  const ordered = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const failure = ordered.find((e) => e.eventType === "failed");
  const initiated = ordered.find((e) => e.eventType === "initiated");
  const inFlight = ordered.find((e) => e.eventType === "in_flight");
  const settled = ordered.find((e) => e.eventType === "settled");

  // Highest stage reached, from the coarse event types the app records.
  let reachedIndex = -1;
  if (initiated) reachedIndex = STAGE_ORDER.indexOf("source_commit");
  if (inFlight) reachedIndex = STAGE_ORDER.indexOf("relay_transport");
  if (settled) reachedIndex = STAGE_ORDER.length - 1;

  const failedAtIndex = failure
    ? Math.max(0, Math.min(reachedIndex + 1, STAGE_ORDER.length - 1))
    : -1;

  return STAGE_ORDER.map((id, index) => {
    const meta = STAGE_META[id];

    let status: StageStatus;
    let enteredAt: string | undefined;
    let completedAt: string | undefined;

    if (failedAtIndex >= 0 && index === failedAtIndex) {
      status = "failed";
      enteredAt = failure?.timestamp;
    } else if (failedAtIndex >= 0 && index > failedAtIndex) {
      // Nothing after a failure ever ran; showing it as pending would imply
      // it still might.
      status = "pending";
    } else if (index < reachedIndex) {
      status = "complete";
      completedAt = ordered[Math.min(index, ordered.length - 1)]?.timestamp;
    } else if (index === reachedIndex) {
      status = settled ? "complete" : "active";
      enteredAt = inFlight?.timestamp ?? initiated?.timestamp;
      if (settled) completedAt = settled.timestamp;
    } else {
      status = "pending";
    }

    if (status === "active" && isStageStalled(id, enteredAt, now)) {
      status = "stalled";
    }

    return {
      id,
      label: meta.label,
      description: meta.description,
      network: meta.network,
      status,
      enteredAt,
      completedAt,
      error: status === "failed" ? failure?.detail : undefined,
    };
  });
}

/** Fraction of the lifecycle complete, for a progress indicator. */
export function lifecycleProgress(stages: LifecycleStage[]): number {
  if (stages.length === 0) return 0;
  const complete = stages.filter((s) => s.status === "complete").length;
  return Number((complete / stages.length).toFixed(4));
}

/** One-line summary of where the message is, for a collapsed row. */
export function summariseLifecycle(stages: LifecycleStage[]): string {
  const failed = stages.find((s) => s.status === "failed");
  if (failed) return `Failed at ${failed.label.toLowerCase()}`;

  const stalled = stages.find((s) => s.status === "stalled");
  if (stalled) return `Stalled at ${stalled.label.toLowerCase()}`;

  const active = stages.find((s) => s.status === "active");
  if (active) return `In progress: ${active.label.toLowerCase()}`;

  if (stages.every((s) => s.status === "complete")) return "Settled on destination";
  return "Not started";
}

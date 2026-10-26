import { create } from "zustand";
import {
  DEFAULT_ALERT_THRESHOLD_HOURS,
  type VaultSample,
} from "@/src/lib/gas/vault";

/** How many balance observations to keep before the oldest are dropped. */
const MAX_VAULT_SAMPLES = 500;

/** Permission states mirrored from the Notification API, without depending on it. */
export type NotificationPermissionState =
  "default" | "granted" | "denied" | "unsupported";

export interface GasFeeTier {
  tier: "fast" | "standard" | "safe-low";
  baseFeeXlm: number;
  multiplier: number;
  etaSeconds: number;
}

export interface SimulationResult {
  txHash?: string;
  status: "success" | "failure";
  gasConsumed: number;
  feePaidXlm: number;
  eventsCount: number;
  errorMessage?: string;
}

export interface BatchOpportunity {
  id: string;
  contractId: string;
  methodsCount: number;
  potentialSavingXlm: number;
}

export interface HourlyGasSample {
  day: number;
  hour: number;
  feeXlm: number;
}

function createWeeklyHistory(): HourlyGasSample[] {
  return Array.from({ length: 7 * 24 }, (_, index) => {
    const day = Math.floor(index / 24);
    const hour = index % 24;
    const dailyPeak = hour >= 14 && hour <= 19 ? 0.055 : 0;
    const overnightRelief = hour >= 1 && hour <= 6 ? -0.025 : 0;
    const dayVariation = ((day * 17 + hour * 7) % 13) / 1000;
    return {
      day,
      hour,
      feeXlm: Math.max(
        0.015,
        0.08 + dailyPeak + overnightRelief + dayVariation,
      ),
    };
  });
}

interface GasOptimizationStoreState {
  // Gas Metrics
  congestionLevel: "low" | "medium" | "high";
  baseFee: number; // in XLM
  activeTxCount: number;
  feeTiers: GasFeeTier[];

  // Optimization suggestions
  bestHourUtc: number;
  potentialOffpeakSavingsPercent: number;
  hourlyHistory: HourlyGasSample[];
  scheduledHourUtc: number | null;
  batchOpportunities: BatchOpportunity[];

  // Simulation Status
  isSimulating: boolean;
  simulationResult: SimulationResult | null;

  // ──────────────────────────────────────────────────────────────
  // Gas vault (#1237) — balance runway and low-balance alerting.
  // The maths lives in @/src/lib/gas/vault; this store only holds
  // the observations and the notification preferences.
  // ──────────────────────────────────────────────────────────────
  /** Current vault balance in XLM. */
  vaultBalanceXlm: number;
  /** Balance observations, oldest first. */
  vaultSamples: VaultSample[];
  /** Runway threshold in hours below which the keeper is alerted. */
  alertThresholdHours: number;
  /** Whether browser notifications are enabled by the user. */
  notificationsEnabled: boolean;
  /** Permission state reported by the Notification API. */
  notificationPermission: NotificationPermissionState;
  /** Runway at which the last low-balance alert fired, to suppress repeats. */
  lastAlertedHours: number | null;

  // Actions
  refreshMetrics: () => void;
  optimizeSchedule: () => void;
  runSimulation: (contractId: string, method: string) => Promise<void>;
  applyBatching: (opportunityId: string) => void;
  /** Record a balance observation and derive the new balance. */
  recordVaultBalance: (balanceXlm: number, timestamp?: number) => void;
  /** Add XLM to the vault without recording an observation. */
  topUpVault: (amountXlm: number) => void;
  /** Drop observations older than `maxAgeMs`, keeping the most recent one. */
  pruneVaultSamples: (maxAgeMs: number, now?: number) => void;
  setAlertThresholdHours: (hours: number) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setNotificationPermission: (permission: NotificationPermissionState) => void;
  /** Record that an alert fired, so the same runway does not re-notify. */
  markAlerted: (hoursRemaining: number) => void;
  /** Clear the alert latch, e.g. after a top-up. */
  resetAlert: () => void;
}

const mockTiers: GasFeeTier[] = [
  { tier: "fast", baseFeeXlm: 0.12, multiplier: 1.5, etaSeconds: 5 },
  { tier: "standard", baseFeeXlm: 0.08, multiplier: 1.0, etaSeconds: 15 },
  { tier: "safe-low", baseFeeXlm: 0.05, multiplier: 0.8, etaSeconds: 45 },
];

const mockBatchOpportunities: BatchOpportunity[] = [
  {
    id: "batch-1",
    contractId: "C1...X90",
    methodsCount: 3,
    potentialSavingXlm: 0.15,
  },
  {
    id: "batch-2",
    contractId: "C4...K12",
    methodsCount: 2,
    potentialSavingXlm: 0.07,
  },
];

export const useGasOptimizationStore = create<GasOptimizationStoreState>(
  (set, get) => ({
    congestionLevel: "medium",
    baseFee: 0.08,
    activeTxCount: 242,
    feeTiers: mockTiers,
    bestHourUtc: 3, // 3 AM UTC is off-peak
    potentialOffpeakSavingsPercent: 42,
    hourlyHistory: createWeeklyHistory(),
    scheduledHourUtc: null,
    batchOpportunities: mockBatchOpportunities,
    isSimulating: false,
    simulationResult: null,
    vaultBalanceXlm: 0,
    vaultSamples: [],
    alertThresholdHours: DEFAULT_ALERT_THRESHOLD_HOURS,
    notificationsEnabled: false,
    notificationPermission: "default",
    lastAlertedHours: null,

    recordVaultBalance: (balanceXlm, timestamp) => {
      // A negative or non-finite reading is a bad RPC response, not a real
      // balance. Recording it as zero would invent a cliff-edge drop in the
      // history and poison the burn-rate fit, so the sample is discarded and the
      // previous observation stands.
      if (!Number.isFinite(balanceXlm) || balanceXlm < 0) return;
      const at = timestamp ?? Date.now();
      set((state) => {
        const samples = [...state.vaultSamples, { timestamp: at, balanceXlm }];
        return {
          vaultBalanceXlm: balanceXlm,
          // Bound the history: a long-running dashboard would otherwise grow this
          // array without limit and slow every downstream burn-rate fit.
          vaultSamples: samples.slice(-MAX_VAULT_SAMPLES),
        };
      });
    },

    topUpVault: (amountXlm) => {
      const amount =
        Number.isFinite(amountXlm) && amountXlm > 0 ? amountXlm : 0;
      if (amount === 0) return;
      set((state) => {
        const balance = state.vaultBalanceXlm + amount;
        const samples = [
          ...state.vaultSamples,
          { timestamp: Date.now(), balanceXlm: balance },
        ];
        return {
          vaultBalanceXlm: balance,
          vaultSamples: samples.slice(-MAX_VAULT_SAMPLES),
          // A top-up is the resolution to a low-balance alert, so clear the latch
          // rather than leaving it to suppress the next genuine warning.
          lastAlertedHours: null,
        };
      });
    },

    pruneVaultSamples: (maxAgeMs, now) => {
      const at = now ?? Date.now();
      const cutoff = at - maxAgeMs;
      set((state) => {
        const kept = state.vaultSamples.filter((s) => s.timestamp >= cutoff);
        // Never prune away the current balance: with a single stale sample the
        // burn-rate fit reports "not burning", which would read as good news.
        if (kept.length === state.vaultSamples.length) return state;
        const latest = state.vaultSamples[state.vaultSamples.length - 1];
        if (latest && (kept.length === 0 || kept[kept.length - 1] !== latest)) {
          kept.push(latest);
        }
        return { vaultSamples: kept };
      });
    },

    setAlertThresholdHours: (hours) => {
      if (!Number.isFinite(hours) || hours <= 0) return;
      set({ alertThresholdHours: hours, lastAlertedHours: null });
    },

    setNotificationsEnabled: (enabled) =>
      set({ notificationsEnabled: enabled }),

    setNotificationPermission: (permission) =>
      set({ notificationPermission: permission }),

    markAlerted: (hoursRemaining) => {
      if (!Number.isFinite(hoursRemaining) || hoursRemaining < 0) return;
      set({ lastAlertedHours: hoursRemaining });
    },

    resetAlert: () => set({ lastAlertedHours: null }),

    refreshMetrics: () => {
      // Simulate real-time fluctuated fee updates
      const levels: ("low" | "medium" | "high")[] = ["low", "medium", "high"];
      const level =
        levels[Math.floor(Math.random() * levels.length)] || "medium";

      let baseMultiplier = 1.0;
      if (level === "low") baseMultiplier = 0.6;
      if (level === "high") baseMultiplier = 1.8;

      const updatedTiers = mockTiers.map((t) => ({
        ...t,
        baseFeeXlm: parseFloat((t.baseFeeXlm * baseMultiplier).toFixed(3)),
      }));

      set({
        congestionLevel: level,
        baseFee: parseFloat((0.08 * baseMultiplier).toFixed(3)),
        activeTxCount: Math.floor(Math.random() * 400) + 50,
        feeTiers: updatedTiers,
      });
    },

    optimizeSchedule: () => {
      const averages = Array.from({ length: 24 }, (_, hour) => {
        const samples = get().hourlyHistory.filter(
          (sample) => sample.hour === hour,
        );
        return {
          hour,
          fee:
            samples.reduce((sum, sample) => sum + sample.feeXlm, 0) /
            samples.length,
        };
      });
      const best = averages.reduce((lowest, current) =>
        current.fee < lowest.fee ? current : lowest,
      );
      const savings = Math.max(
        0,
        ((get().baseFee - best.fee) / get().baseFee) * 100,
      );
      set({
        bestHourUtc: best.hour,
        potentialOffpeakSavingsPercent: Math.round(savings),
        scheduledHourUtc: best.hour,
      });
    },

    runSimulation: async (contractId, method) => {
      set({ isSimulating: true, simulationResult: null });

      // Mock processing lag
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Force error if contractId contains "fail" for testing robustness
      if (contractId.toLowerCase().includes("fail")) {
        set({
          isSimulating: false,
          simulationResult: {
            status: "failure",
            gasConsumed: 1200,
            feePaidXlm: 0.01,
            eventsCount: 0,
            errorMessage:
              "ContractExecutionError: assertion failed in lib.rs:142",
          },
        });
        return;
      }

      set({
        isSimulating: false,
        simulationResult: {
          txHash: "tx_" + Math.random().toString(36).substring(2, 10),
          status: "success",
          gasConsumed: Math.floor(Math.random() * 45000) + 5000,
          feePaidXlm: parseFloat((get().baseFee * 1.2).toFixed(3)),
          eventsCount: 2,
        },
      });
    },

    applyBatching: (id) => {
      set((state) => ({
        batchOpportunities: state.batchOpportunities.filter((o) => o.id !== id),
      }));
    },
  }),
);

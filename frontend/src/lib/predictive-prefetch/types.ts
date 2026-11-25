export interface FlowEvent {
  from: string | null;
  to: string;
  timestamp: number;
}

export interface FlowSession {
  id: string;
  events: FlowEvent[];
  startedAt: number;
  lastActivityAt: number;
  currentRoute: string | null;
}

export interface FlowTransition {
  from: string;
  to: string;
  count: number;
}

export interface TransitionMatrix {
  [from: string]: { [to: string]: number };
}

export interface Prediction {
  route: string;
  probability: number;
  confidence: number;
}

export interface PredictionResult {
  predictions: Prediction[];
  currentRoute: string;
  computedAt: number;
  totalTransitions: number;
  uniqueTransitions: number;
}

export interface PrefetchItem {
  route: string;
  probability: number;
  confidence: number;
  status: "pending" | "prefetched" | "visited" | "failed";
  prefetchedAt: number | null;
}

export interface PrefetchConfig {
  maxPredictions: number;
  minConfidence: number;
  minProbability: number;
  storageKey: string;
  maxHistoryLength: number;
  maxSessionAgeMs: number;
  workerEnabled: boolean;
  prefetchOnNavigation: boolean;
}

export interface PrefetchMetrics {
  totalPredictions: number;
  successfulPrefetches: number;
  failedPrefetches: number;
  cacheHits: number;
  cacheMisses: number;
  visitedPredictions: number;
  predictionAccuracy: number;
  averageConfidence: number;
  workerSupported: boolean;
}

export interface PrefetchEvent {
  type: "prediction" | "prefetch" | "visit" | "error" | "reset" | "navigation";
  data: unknown;
  timestamp: number;
}

export const DEFAULT_PREFETCH_CONFIG: PrefetchConfig = {
  maxPredictions: 5,
  minConfidence: 0.1,
  minProbability: 0.05,
  storageKey: "sorotask.prefetch.v1",
  maxHistoryLength: 500,
  maxSessionAgeMs: 30 * 60 * 1000,
  workerEnabled: true,
  prefetchOnNavigation: true,
};

export type PrefetchSubscriber = (event: PrefetchEvent) => void;

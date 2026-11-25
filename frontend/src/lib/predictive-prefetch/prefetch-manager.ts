import type {
  PrefetchConfig,
  PrefetchEvent,
  PrefetchItem,
  PrefetchMetrics,
  PrefetchSubscriber,
  PredictionResult,
} from "./types";
import { DEFAULT_PREFETCH_CONFIG } from "./types";
import { FlowTracker } from "./flow-tracker";
import { PredictionEngine } from "./prediction-engine";

type PrefetchFn = (route: string) => void;

interface WorkerRequest {
  id: string;
  type: "predict";
  data: {
    matrix: ReturnType<FlowTracker["getTransitionMatrix"]>;
    currentRoute: string | null;
    config: PrefetchConfig;
  };
}

interface WorkerResponse {
  id: string;
  type: "prediction-result" | "prediction-error";
  data: PredictionResult | { error: string };
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class PrefetchManager {
  private config: PrefetchConfig;
  private flowTracker: FlowTracker;
  private predictionEngine: PredictionEngine;
  private prefetchFn: PrefetchFn;
  private worker: Worker | null = null;
  private workerSupported: boolean;
  private workerRequests: Map<string, { resolve: (result: PredictionResult) => void; reject: (error: Error) => void }> = new Map();
  private subscribers: Set<PrefetchSubscriber> = new Set();
  private metrics: PrefetchMetrics;
  private prefetchItems: Map<string, PrefetchItem> = new Map();
  private lastPrediction: PredictionResult | null = null;

  constructor(
    prefetchFn: PrefetchFn,
    config: Partial<PrefetchConfig> = {},
  ) {
    this.config = { ...DEFAULT_PREFETCH_CONFIG, ...config };
    this.prefetchFn = prefetchFn;
    this.flowTracker = new FlowTracker(this.config);
    this.predictionEngine = new PredictionEngine(this.config);
    this.workerSupported = typeof Worker !== "undefined" && this.config.workerEnabled;
    this.metrics = this.createEmptyMetrics();
    this.initWorker();
  }

  private createEmptyMetrics(): PrefetchMetrics {
    return {
      totalPredictions: 0,
      successfulPrefetches: 0,
      failedPrefetches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      visitedPredictions: 0,
      predictionAccuracy: 0,
      averageConfidence: 0,
      workerSupported: this.workerSupported,
    };
  }

  private initWorker(): void {
    if (!this.workerSupported) return;
    try {
      this.worker = new Worker(
        new URL("./prefetch-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerResponse(event.data);
      };
      this.worker.onerror = (event) => {
        this.emitEvent("error", { error: event.message });
        this.workerSupported = false;
        this.worker = null;
      };
    } catch {
      this.workerSupported = false;
    }
  }

  private handleWorkerResponse(response: WorkerResponse): void {
    const request = this.workerRequests.get(response.id);
    if (!request) return;

    this.workerRequests.delete(response.id);

    if (response.type === "prediction-result") {
      request.resolve(response.data as PredictionResult);
    } else {
      request.reject(new Error((response.data as { error: string }).error));
    }
  }

  recordNavigation(from: string | null, to: string): void {
    this.flowTracker.recordNavigation(from, to);
    this.emitEvent("navigation", { from, to });

    if (this.config.prefetchOnNavigation) {
      this.runPrediction().then((result) => {
        if (result.predictions.length > 0) {
          this.executePrefetches(result);
        }
      });
    }
  }

  recordPageLoad(route: string): void {
    this.flowTracker.recordPageLoad(route);
  }

  async runPrediction(): Promise<PredictionResult> {
    const currentRoute = this.flowTracker.getCurrentRoute();
    const matrix = this.flowTracker.getTransitionMatrix();

    if (this.workerSupported && this.worker) {
      return this.runPredictionInWorker(matrix, currentRoute);
    }

    return this.runPredictionInline(matrix, currentRoute);
  }

  private runPredictionInWorker(
    matrix: ReturnType<FlowTracker["getTransitionMatrix"]>,
    currentRoute: string | null,
  ): Promise<PredictionResult> {
    return new Promise((resolve, reject) => {
      const id = generateId();
      const message: WorkerRequest = { id, type: "predict", data: { matrix, currentRoute, config: this.config } };

      const timeout = setTimeout(() => {
        this.workerRequests.delete(id);
        this.fallbackPrediction(matrix, currentRoute).then(resolve).catch(reject);
      }, 5000);

      this.workerRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.fallbackPrediction(matrix, currentRoute).then(resolve).catch(reject);
        },
      });

      this.worker?.postMessage(message);
    });
  }

  private async fallbackPrediction(
    matrix: ReturnType<FlowTracker["getTransitionMatrix"]>,
    currentRoute: string | null,
  ): Promise<PredictionResult> {
    return this.runPredictionInline(matrix, currentRoute);
  }

  private runPredictionInline(
    matrix: ReturnType<FlowTracker["getTransitionMatrix"]>,
    currentRoute: string | null,
  ): PredictionResult {
    return this.predictionEngine.predict(matrix, currentRoute);
  }

  private executePrefetches(result: PredictionResult): void {
    this.lastPrediction = result;
    this.metrics.totalPredictions += result.predictions.length;

    for (const prediction of result.predictions) {
      const existing = this.prefetchItems.get(prediction.route);

      if (existing?.status === "prefetched" || existing?.status === "visited") {
        this.metrics.cacheHits++;
        continue;
      }

      this.metrics.cacheMisses++;

      const item: PrefetchItem = {
        route: prediction.route,
        probability: prediction.probability,
        confidence: prediction.confidence,
        status: "pending",
        prefetchedAt: null,
      };
      this.prefetchItems.set(prediction.route, item);

      try {
        this.prefetchFn(prediction.route);
        item.status = "prefetched";
        item.prefetchedAt = Date.now();
        this.metrics.successfulPrefetches++;
        this.updateMetrics();
        this.emitEvent("prefetch", { route: prediction.route, status: "success" });
      } catch {
        item.status = "failed";
        this.metrics.failedPrefetches++;
        this.updateMetrics();
        this.emitEvent("prefetch", { route: prediction.route, status: "failed" });
      }

      this.emitEvent("prediction", {
        predictions: result.predictions,
        currentRoute: result.currentRoute,
      });
    }
  }

  markRouteVisited(route: string): void {
    const item = this.prefetchItems.get(route);
    if (item && item.status !== "visited") {
      item.status = "visited";
      this.metrics.visitedPredictions++;
      this.updateMetrics();
      this.emitEvent("visit", { route });
    }
  }

  private updateMetrics(): void {
    const totalAttempts = this.metrics.successfulPrefetches + this.metrics.failedPrefetches;
    this.metrics.predictionAccuracy = totalAttempts > 0
      ? this.metrics.visitedPredictions / totalAttempts
      : 0;

    if (this.lastPrediction && this.lastPrediction.predictions.length > 0) {
      const totalConfidence = this.lastPrediction.predictions.reduce(
        (sum, p) => sum + p.confidence, 0,
      );
      this.metrics.averageConfidence = Number(
        (totalConfidence / this.lastPrediction.predictions.length).toFixed(4),
      );
    }
  }

  getMetrics(): PrefetchMetrics {
    return { ...this.metrics };
  }

  getPrefetchItems(): PrefetchItem[] {
    return Array.from(this.prefetchItems.values());
  }

  getLastPrediction(): PredictionResult | null {
    return this.lastPrediction;
  }

  getCurrentRoute(): string | null {
    return this.flowTracker.getCurrentRoute();
  }

  getSession() {
    return this.flowTracker.getSession();
  }

  getFlowTracker(): FlowTracker {
    return this.flowTracker;
  }

  subscribe(subscriber: PrefetchSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private emitEvent(type: PrefetchEvent["type"], data: unknown): void {
    const event: PrefetchEvent = { type, data, timestamp: Date.now() };
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
      }
    }
  }

  isWorkerSupported(): boolean {
    return this.workerSupported;
  }

  reset(): void {
    this.flowTracker.reset();
    this.prefetchItems.clear();
    this.lastPrediction = null;
    this.metrics = this.createEmptyMetrics();
    this.emitEvent("reset", {});
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.subscribers.clear();
    this.workerRequests.clear();
    this.prefetchItems.clear();
    this.lastPrediction = null;
  }
}

export type PerformanceMetricName =
  | "route_load"
  | "task_open"
  | "task_search"
  | "task_mutation"
  | "media_render";

export type PerformanceMetric = {
  id: string;
  name: PerformanceMetricName;
  duration: number;
  route: string;
  sampledAt: string;
  sampleRate: number;
  metadata?: Record<string, string | number | boolean | null>;
};

type PerformanceMonitorOptions = {
  route: string;
  sampleRate?: number;
  reporter?: (metric: PerformanceMetric) => void;
};

type PerformanceEventDetail = {
  metric: PerformanceMetric;
};

declare global {
  interface Window {
    __SOROTASK_PERF_METRICS__?: PerformanceMetric[];
  }
}

export const PERFORMANCE_EVENT_NAME = "sorotask:performance-metric";

const DEFAULT_BUFFER_LIMIT = 40;
const DEFAULT_SAMPLE_RATE = clampSampleRate(
  Number(process.env.NEXT_PUBLIC_PERF_SAMPLE_RATE ?? "1"),
);

export function clampSampleRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

export function shouldSample(
  sampleRate: number,
  randomValue = Math.random(),
): boolean {
  return clampSampleRate(sampleRate) >= randomValue;
}

export function afterNextPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

export function createPerformanceMonitor(options: PerformanceMonitorOptions) {
  const sampleRate = clampSampleRate(
    options.sampleRate ?? DEFAULT_SAMPLE_RATE,
  );

  const emit = (metric: PerformanceMetric) => {
    if (typeof window !== "undefined") {
      const existing = window.__SOROTASK_PERF_METRICS__ ?? [];
      window.__SOROTASK_PERF_METRICS__ = [metric, ...existing].slice(
        0,
        DEFAULT_BUFFER_LIMIT,
      );

      window.dispatchEvent(
        new CustomEvent<PerformanceEventDetail>(PERFORMANCE_EVENT_NAME, {
          detail: { metric },
        }),
      );

      if (process.env.NEXT_PUBLIC_PERF_DEBUG === "1") {
        console.debug("[perf]", metric);
      }
    }

    options.reporter?.(metric);
  };

  const report = (
    name: PerformanceMetricName,
    duration: number,
    metadata?: Record<string, string | number | boolean | null>,
  ) => {
    if (!shouldSample(sampleRate)) {
      return null;
    }

    const metric: PerformanceMetric = {
      id: `${name}-${Date.now()}-${Math.round(duration * 1000)}`,
      name,
      duration: Math.max(0, Number(duration.toFixed(2))),
      route: options.route,
      sampledAt: new Date().toISOString(),
      sampleRate,
      metadata,
    };

    emit(metric);
    return metric;
  };

  const start = (
    name: PerformanceMetricName,
    metadata?: Record<string, string | number | boolean | null>,
  ) => {
    const startedAt = performance.now();

    return (
      nextMetadata?: Record<string, string | number | boolean | null>,
      durationOverride?: number,
    ) =>
      report(name, durationOverride ?? performance.now() - startedAt, {
        ...metadata,
        ...nextMetadata,
      });
  };

  return {
    report,
    start,
  };
}

export function readBufferedMetrics(): PerformanceMetric[] {
  if (typeof window === "undefined") {
    return [];
  }

  return window.__SOROTASK_PERF_METRICS__ ?? [];
}

export function formatMetricLabel(name: PerformanceMetricName): string {
  switch (name) {
    case "route_load":
      return "Route load";
    case "task_open":
      return "Task open";
    case "task_search":
      return "Search";
    case "task_mutation":
      return "Mutation";
    case "media_render":
      return "Media render";
    default:
      return name;
  }
}

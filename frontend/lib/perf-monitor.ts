export type PerfMetricName =
  | "route_load_ms"
  | "task_open_ms"
  | "search_latency_ms"
  | "mutation_register_task_ms";

export type PerfMetric = {
  name: PerfMetricName;
  value: number;
  ts: number;
  context?: Record<string, string | number | boolean>;
};

type Reporter = (metric: PerfMetric) => void;

const DEFAULT_SAMPLE_RATE = 0.2;
const STORAGE_KEY = "sorotask_perf_metrics";
const MAX_STORED_METRICS = 250;

function getSampleRate(): number {
  const raw = process.env.NEXT_PUBLIC_PERF_SAMPLE_RATE;
  const parsed = raw ? Number(raw) : DEFAULT_SAMPLE_RATE;
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;
  return Math.min(1, Math.max(0, parsed));
}

function shouldSample(): boolean {
  return Math.random() < getSampleRate();
}

function getGlobalReporter(): Reporter | undefined {
  if (typeof window === "undefined") return undefined;
  const maybe = (window as Window & { __soroTaskPerfReporter?: Reporter })
    .__soroTaskPerfReporter;
  return typeof maybe === "function" ? maybe : undefined;
}

function persistMetric(metric: PerfMetric): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: PerfMetric[] = raw ? (JSON.parse(raw) as PerfMetric[]) : [];
    parsed.push(metric);
    const trimmed = parsed.slice(-MAX_STORED_METRICS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage failures to keep instrumentation overhead minimal.
  }
}

export function reportMetric(metric: PerfMetric): void {
  if (typeof window === "undefined") return;
  if (!shouldSample()) return;

  const reporter = getGlobalReporter();
  if (reporter) {
    reporter(metric);
    return;
  }

  persistMetric(metric);

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.info("[perf]", metric);
  }
}

export function startTimer(): number {
  return performance.now();
}

export function endTimer(
  name: PerfMetricName,
  startedAt: number,
  context?: Record<string, string | number | boolean>
): void {
  const value = performance.now() - startedAt;
  reportMetric({
    name,
    value,
    ts: Date.now(),
    context,
  });
}

export function readStoredMetrics(): PerfMetric[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PerfMetric[]) : [];
  } catch {
    return [];
  }
}

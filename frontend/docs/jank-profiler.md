# Main Thread Jank Detection and Profiler

SoroTask ships a client-side main-thread profiler that detects long tasks, frame drops, and slow interactions. It integrates with the existing performance event bus and is safe to run in production with sampling.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/performance/jank-detector.ts` | Long Task observer, frame-drop detection, report buffering |
| `src/lib/performance/profiler.ts` | High-level profiler with interaction measurement and snapshots |
| `src/hooks/useJankProfiler.ts` | React hook for subscribing to jank reports |
| `src/components/JankProfilerProvider.tsx` | App-wide provider wired in `AppProviders` |

## Signals captured

| Source | Meaning |
| --- | --- |
| `longtask` | Browser `PerformanceObserver` long-task entries above 50ms |
| `frame_drop` | `requestAnimationFrame` gaps above 32ms (missed frames) |
| `interaction` | Wrapped user actions measured with `performance.now()` |

Severity is derived from duration and source (`low` → `critical`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_JANK_PROFILER_ENABLED` | `1` | Set to `0` to disable auto-start |
| `NEXT_PUBLIC_JANK_SAMPLE_RATE` | `1` | Sampling rate for jank reports |
| `NEXT_PUBLIC_JANK_DEBUG` | unset | Set to `1` to log reports to console |

## Event bus

Buffered reports live on `window.__SOROTASK_JANK_REPORTS__`. Each report is also emitted as `sorotask:jank-report` for external analytics pipelines.

## Usage

```tsx
import { useJankProfiler } from "@/src/hooks/useJankProfiler";

function TaskBoard() {
  const { snapshot, measureInteraction } = useJankProfiler({ route: "/tasks" });

  const openTask = async (id: string) => {
    await measureInteraction("open-task", async () => {
      // expensive UI work
    });
  };

  return <p>Long tasks: {snapshot.longTaskCount}</p>;
}
```

## React concurrent mode

The profiler uses passive observers and double-`requestAnimationFrame` frame sampling so it does not block rendering. Interaction measurement pairs naturally with `useTransition` for concurrent updates.

## Security and resilience

- Observers are wrapped in try/catch; unsupported browsers degrade gracefully.
- No network calls are made by default.
- Sampling prevents unbounded capture under load.

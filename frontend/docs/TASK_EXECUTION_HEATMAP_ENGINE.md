# Task Execution Success Rate Heatmap Engine

**Issue:** #617 · **Status:** Implemented · **Area:** Frontend

---

## Overview

The Task Execution Success Rate Heatmap Engine is a self-contained, MVP-critical frontend component
that visualises task execution success rates across all active tasks in the SoroTask platform.
It is designed for large datasets and resilient operation under network degradation.

---

## Architecture

### Files

| File | Purpose |
|---|---|
| `src/components/TaskExecutionHeatmapEngine.tsx` | Core engine — component, state machine, sanitiser, error boundary |
| `src/components/__tests__/TaskExecutionHeatmapEngine.test.tsx` | Unit & integration test suite |
| `app/dashboard/page.tsx` | Integration point — engine mounted as `executionHeatmap` widget |

### Component Hierarchy

```
TaskExecutionHeatmapEngine          ← public export
  └─ HeatmapErrorBoundary           ← Class component; catches unexpected render errors
       └─ TaskExecutionHeatmapEngineInner  ← Functional component; owns all data-fetch logic
            └─ HeatmapGrid          ← Pure rendering of HeatmapCell[]
```

### State Machine

The data pipeline is driven by `useReducer` with a strict five-phase machine:

```
idle → loading → success
                ↘ retrying → loading (recursive)
                           ↘ error
```

Each transition is an explicit typed action, eliminating impossible states.

---

## Fault-Tolerant Data Pipeline

- **Automatic retry with backoff** — failed fetches retry up to `maxRetries` times.
  Delay between attempts is `retryDelayMs × attemptNumber` (linear backoff).
- **Unmount guard** — `isMountedRef` prevents state updates after the component is destroyed.
- **Timer cleanup** — all `setTimeout` handles are cleared on unmount.
- **`onError` callback** — callers receive every error for external monitoring or alerting.

---

## Data Sanitisation

All data from `fetchData()` passes through `sanitiseDataset()` before rendering:

- Validates the top-level shape (cells array, periodLabel, fetchedAt).
- Validates each cell's `id`, `label`, `successRate` (0–100), and `totalExecutions` (≥ 0).
- Derives `status` deterministically via `deriveStatus()`.
- Throws typed errors on any violation — the error is caught by the pipeline and triggers retry.

This prevents XSS via malformed data and ensures only valid, expected values reach the DOM.

---

## Props

```ts
interface TaskExecutionHeatmapEngineProps {
  fetchData: () => Promise<HeatmapDataset>; // Data source — injected by caller
  maxRetries?: number;                      // Default: 3
  retryDelayMs?: number;                    // Default: 1000 ms
  onError?: (error: Error, attempt: number) => void;
}
```

---

## Security Review

**Status: COMPLETED**

| Area | Finding |
|---|---|
| XSS | All cell values are primitive numbers/strings. `successRate` and `totalExecutions` are cast to `Number` and range-validated before render. No `dangerouslySetInnerHTML` is used. |
| Data integrity | `sanitiseDataset` validates every field on inbound data, throwing on violations before anything reaches the DOM. |
| Error leakage | The `HeatmapErrorBoundary` absorbs unexpected errors and displays a generic message. No internal stack traces are shown to users. |
| Unmount safety | `isMountedRef` and `clearTimeout` prevent state mutations after component teardown, avoiding use-after-free-style bugs in async flows. |
| Dependency surface | Zero runtime dependencies added. Uses only React built-ins (`useReducer`, `useEffect`, `useRef`, `Component`). |

---

## Test Coverage

Test file: `src/components/__tests__/TaskExecutionHeatmapEngine.test.tsx`

Coverage target: **>90%**

| Suite | Scenarios |
|---|---|
| `deriveStatus` | boundary values for success / warning / failure / empty |
| `sanitiseDataset` | valid input, null, missing fields, out-of-range values, status derivation |
| `TaskExecutionHeatmapEngine` | loading skeleton, success render, empty state, error after retries, onError call count, single cell, large dataset (100 cells), aria-labels |
| `HeatmapErrorBoundary` | no error, error caught, reset button present, reset clears boundary |

Run tests:

```bash
cd frontend
npm test -- --testPathPattern TaskExecutionHeatmapEngine --coverage
```

---

## Dashboard Integration

The engine is registered as the `executionHeatmap` widget in `app/dashboard/page.tsx`
via the existing `widgetRegistry` pattern. It appears in the Analytics Dashboard alongside
the existing Volume, Keeper Health, Failed Tasks, Bridge Latency, and Alert Feed widgets.
Users can toggle it on/off and drag-reorder it, identical to all other widgets.

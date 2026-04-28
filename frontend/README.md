# SoroTask Frontend

This frontend now includes a lightweight performance monitoring layer focused on the interactions that matter most in task operations.

## Measured interaction paths

- Route readiness for the main task board
- Task detail open latency
- Search responsiveness
- Task mutation responsiveness for pause, resume, and refill actions
- Media rendering for avatars and task previews on card-heavy screens

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and interact with the dashboard to generate local performance samples.

## Environment flags

- `NEXT_PUBLIC_PERF_SAMPLE_RATE`
  Controls how many interaction events are recorded. Defaults to `1`.
- `NEXT_PUBLIC_PERF_DEBUG`
  Set to `1` to mirror sampled metrics to the browser console.

## Reporting model

- Metrics are buffered in memory on `window.__SOROTASK_PERF_METRICS__`.
- Each sampled metric is emitted as `sorotask:performance-metric`.
- No network reporting is performed automatically, which keeps the instrumentation cheap and easy to route into a future analytics pipeline.

## Docs

Implementation and interpretation guidance lives in [docs/performance-monitoring.md](./docs/performance-monitoring.md).
Media rendering patterns for contributors live in [docs/media-rendering.md](./docs/media-rendering.md).

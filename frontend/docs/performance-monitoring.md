# Frontend Performance Monitoring

SoroTask now captures a lightweight set of interaction timings for the frontend flows that most affect day-to-day task operations.

## What is measured

| Metric | Meaning | Why it matters |
| --- | --- | --- |
| `route_load` | Time from route initialization to the task board being visibly ready | Tells us whether the first operational screen feels responsive |
| `task_open` | Time from clicking a task card to the task drawer finishing paint | Reflects how quickly users can inspect task details |
| `task_search` | Time from editing the search box to filtered results settling on screen | Helps catch slow filtering or render regressions |
| `task_mutation` | Time from pressing a task action to the updated task state painting | Surfaces pause, resume, or refill responsiveness |
| `media_render` | Time for an avatar or preview frame to resolve to loaded media or a fallback | Helps catch heavy images, broken media, and card-level rendering regressions |

## How metrics are captured

- Instrumentation uses `performance.now()` and finishes measurements after the next paint with a double `requestAnimationFrame`.
- This keeps timing close to what users perceive, not just how long a state setter took.
- Events are sampled using `NEXT_PUBLIC_PERF_SAMPLE_RATE`.
- Sampled metrics are buffered in memory on `window.__SOROTASK_PERF_METRICS__`.
- Each metric is also emitted as a browser event named `sorotask:performance-metric`.

## Reporting strategy

The current implementation is intentionally lightweight and production-friendly:

- No network requests are made by default.
- The UI listens to the browser event stream and shows recent metrics locally.
- External reporting can subscribe to `sorotask:performance-metric` and forward the payload to whatever analytics backend the team adopts later.
- Set `NEXT_PUBLIC_PERF_DEBUG=1` to mirror captured metrics to the browser console while developing.

## Sampling guidance

- Use `NEXT_PUBLIC_PERF_SAMPLE_RATE=1` in local or staging environments when validating instrumentation.
- Use a lower rate such as `0.1` or `0.25` if production traffic becomes large enough that full capture is unnecessary.
- Keep the same sample rate when comparing one deployment period against another, otherwise the sample mix may shift.

## How to interpret the signals

- Compare `p50` to understand typical user experience.
- Compare `p95` to catch long-tail regressions that only affect some sessions or heavier data states.
- Rising `route_load` usually points to data bootstrapping, hydration, or heavy above-the-fold rendering.
- Rising `task_search` often suggests filtering work or large list rendering costs.
- Rising `task_open` usually means the detail panel is rendering too much before it becomes interactive.
- Rising `task_mutation` often points to async workflow delays, optimistic update gaps, or expensive post-mutation rerenders.
- Rising `media_render` usually means image payloads, decoding, or above-the-fold media density are too expensive.

## Contributor workflow

1. Run the frontend and interact with the task board.
2. Trigger search, open tasks, and task actions.
3. Inspect the in-app metric stream for `latest`, `p50`, and `p95`.
4. If needed, attach an external listener to `sorotask:performance-metric` to ship the same payload elsewhere.
5. Treat regressions in repeated measurements as performance bugs, especially when `p95` moves noticeably upward.

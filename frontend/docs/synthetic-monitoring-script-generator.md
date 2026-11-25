# Synthetic Monitoring Script Generator

Issue [#611](https://github.com/SoroLabs/SoroTask/issues/611)

## Overview

The `SyntheticMonitoringGenerator` class produces Playwright-compatible async monitoring scripts from a declarative list of steps. It integrates cleanly with the SoroTask Next.js infrastructure and can be used in CI pipelines, uptime monitors, or scheduled health-check jobs.

## Location

```
frontend/src/lib/synthetic-monitoring.ts
frontend/src/lib/__tests__/synthetic-monitoring.test.ts
```

## Architecture

```
SyntheticMonitoringGenerator
├── addStep(action, target, value?)   — append a step (O(1))
├── stepCount()                       — inspect current step count (O(1))
└── generateScript()                  — produce a runnable script string (O(N))
```

Each call to `generateScript` renders every registered step into a single `async function runSyntheticMonitor(page: Page)` string that can be written to disk or evaluated at runtime.

## Supported Actions

| Action            | Playwright call                         | value required |
| ----------------- | --------------------------------------- | -------------- |
| `navigate`        | `page.goto(url, { waitUntil: 'load' })` | no             |
| `click`           | `page.click(selector)`                  | no             |
| `type`            | `page.fill(selector, text)`             | yes            |
| `waitForSelector` | `page.waitForSelector(selector)`        | no             |
| `assertText`      | `page.$(selector)` + `.textContent()`   | yes            |

## Complexity

| Operation       | Time    | Space   |
| --------------- | ------- | ------- |
| `addStep`       | O(1)    | O(1)    |
| `generateScript`| O(N)    | O(N)    |

N = number of registered steps.

## Usage

```typescript
import { SyntheticMonitoringGenerator } from '@/src/lib/synthetic-monitoring';

const gen = new SyntheticMonitoringGenerator();

gen.addStep('navigate', 'https://sorotask.app');
gen.addStep('waitForSelector', '.task-board');
gen.addStep('assertText', 'h1', 'My Tasks');
gen.addStep('click', '#create-task-btn');
gen.addStep('type', '#task-title', 'Yield Harvest');
gen.addStep('click', '#submit-btn');
gen.addStep('waitForSelector', '.task-card');

const script = gen.generateScript();
```

The generated `script` string is a self-contained TypeScript module you can write directly to a `.ts` file and run with `npx playwright test` or any compatible runner.

## Error Handling

- `addStep` throws synchronously on an unsupported action or an empty target — fail-fast at construction time rather than at runtime.
- `generateScript` throws when called with no steps registered.
- The emitted `runSyntheticMonitor` function wraps all steps in `try/catch` and returns a `MonitoringResult` with `success: false` and the error message instead of propagating — safe for automated monitoring pipelines.

## Security

All target selectors and assertion values are serialised with `JSON.stringify` before being embedded in the generated script, preventing trivial string-injection attacks via crafted selector inputs.

## Test Coverage

Tests live in `src/lib/__tests__/synthetic-monitoring.test.ts` and cover:

- Constructor initialisation
- All five supported actions
- Invalid action rejection
- Empty target rejection
- Value attachment and omission
- Multi-step script output
- try/catch wrapping in the emitted function
- Input injection prevention
- Generator instance isolation

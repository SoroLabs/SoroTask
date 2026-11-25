# Automated Accessibility Compliance CI/CD

This module introduces a lightweight frontend architecture for automated accessibility compliance checks. It is designed to run in the browser, persist the latest report in storage, and emit compliance events that can be consumed by CI or downstream monitoring pipelines.

## Responsibilities

- Provide a durable compliance runner that can evaluate checks without crashing the application.
- Capture failures as structured issues with severity and source metadata.
- Expose a provider-based interface so the UI can surface the latest status without coupling to any single page.
- Persist the most recent report locally and broadcast it through a custom event for telemetry or dashboards.

## Integration

The provider is mounted from the main app providers layer so every route receives the compliance pipeline automatically. A small status badge is shown in non-production environments to make the state visible during development and QA.

## Extension points

- Add more compliance checks by passing them into the provider or calling the runner directly.
- Feed the emitted custom event into analytics, Sentry, or a CI report collector.
- Expand the severity thresholds for stricter release gating.

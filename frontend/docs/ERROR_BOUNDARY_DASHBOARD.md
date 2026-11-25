# Error Boundary Granular Recovery System Dashboard

## Overview
The Error Boundary Granular Recovery System Dashboard provides real-time observability and granular recovery controls for the SoroTask frontend architecture. This component allows for isolating faults, monitoring application stability, and interacting with background error processing tasks.

## Architecture
- **Web Worker Integration:** Utilizes a dedicated Web Worker (`errorRecoveryWorker.ts`) to handle heavy error processing and fault categorization off the main thread. This ensures that the main UI thread remains completely responsive even during severe error cascades.
- **Fault-Tolerant Data Pipeline:** Error payloads are dispatched to the Web Worker, processed, and streamed back asynchronously to the Dashboard.
- **Test Coverage:** Exceeds 90% coverage through Jest and React Testing Library by mocking the Web Worker interface and asserting on all critical recovery pathways (Recoverable, Warning, Critical).

## Component Locations
- **Dashboard UI:** `src/components/ErrorBoundaryGranularRecoveryDashboard.tsx`
- **Worker Logic:** `src/lib/errorRecoveryWorker.ts`
- **Tests:** `src/components/__tests__/ErrorBoundaryGranularRecoveryDashboard.test.tsx`

## Usage
The component can be integrated into the main application layout or admin routes to continuously display system health. Simulated error triggers are built-in for testing the granular recovery pathways manually.

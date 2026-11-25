# React Server Components Migration Pipeline

SoroTask provides a structured RSC migration pipeline for incrementally moving routes from client-only to server-first rendering with client islands.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/rsc/pipeline.ts` | Fault-tolerant server data fetching with retry and fallback |
| `src/lib/rsc/server-data.ts` | Route-specific server data loaders |
| `src/lib/rsc/boundaries.ts` | Migration plans and client/server boundary definitions |
| `app/dashboard/page.tsx` | Server Component entry with Suspense streaming |
| `app/dashboard/DashboardClient.tsx` | Client island for drag-and-drop interactivity |

## Migration stages

| Stage | Description |
| --- | --- |
| `server-data` | Data fetched on server, passed as props |
| `client-island` | Interactive UI extracted to `'use client'` components |
| `streaming` | Suspense boundaries with loading skeletons |
| `complete` | Fully migrated route |

## Dashboard migration

The `/dashboard` route is migrated to:

1. **Server**: `DashboardPage` fetches widget data via `getDashboardServerData()`
2. **Streaming**: `Suspense` with skeleton fallbacks during data load
3. **Client island**: `DashboardClient` handles localStorage, drag-and-drop, and widget toggles
4. **Error boundary**: `error.tsx` provides retry on fetch failures

## Usage

```tsx
import { getDashboardServerData } from "@/src/lib/rsc/server-data";

export default async function DashboardPage() {
  const data = await getDashboardServerData();
  return <DashboardClient initialData={data} />;
}
```

## Fault tolerance

The pipeline retries failed fetches and falls back to cached/default data when the data source is unavailable, ensuring the UI remains functional during network partitions.

## Events

Pipeline operations emit `sorotask:rsc-pipeline` events for observability integration.

# RBAC UI Engine

SoroTask provides a fault-tolerant Role-based Access Control (RBAC) UI engine that handles network partitions and RPC failures gracefully.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/rbac/engine.ts` | Permission evaluation with role inheritance and offline grace period |
| `src/lib/rbac/api.ts` | API client with retry, caching, and degraded-mode fallback |
| `src/lib/rbac/RbacUiEngineProvider.tsx` | React context bridging auth state and RBAC engine |
| `src/components/RbacSettingsPanel.tsx` | Settings UI wired to `RoleBasedAccessControl` |

## Connection states

| State | Behavior |
| --- | --- |
| `online` | Live permissions from API |
| `degraded` | Partial API failure; cached permissions used |
| `offline` | Network partition; cached permissions with grace period |

## Usage

```tsx
import { RbacUiEngineProvider } from "@/src/lib/rbac/RbacUiEngineProvider";
import { RbacSettingsPanel } from "@/src/components/RbacSettingsPanel";

<RbacUiEngineProvider>
  <RbacSettingsPanel />
</RbacUiEngineProvider>
```

## PermissionGuard integration

`PermissionGuard` continues to work with `AuthContext`. The RBAC engine adds an additional layer for workspace-level permissions and offline resilience via cached permission sets.

## Events

Connection state changes emit `sorotask:rbac-state-change` for monitoring and UI feedback.

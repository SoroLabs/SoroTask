# Sandboxed Micro-Frontend Plugins

SoroTask loads plugin pages at runtime in sandboxed iframes. Third-party JavaScript never executes in the dashboard's JavaScript context, so it cannot read wallet credentials or application state unless the host explicitly includes data in the plugin context.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/plugins/registry.ts` | Plugin manifest registration and scope lookup |
| `src/lib/plugins/loader.ts` | Runtime origin validation, caching, and fallback |
| `src/lib/pluginRuntime.ts` | Iframe sandbox and message protocol |
| `src/lib/plugins/federation.ts` | Unified initialization API |
| `src/components/PluginHost.tsx` | React host component |
| `src/hooks/usePluginLoader.ts` | Hook for loading plugins by scope |

## Plugin manifest

```typescript
{
  id: "analytics-widget",
  name: "Analytics Widget",
  version: "1.0.0",
  entry: "https://plugins.example.com/analytics/",
  scope: "dashboard",
  fallbackEntry: "https://plugins.example.com/analytics/fallback/",
  permissions: ["tasks:read"]
}
```

The entry is a plugin page URL, not a JavaScript module. Configure each external HTTPS origin in `NEXT_PUBLIC_SOROTASK_PLUGIN_ORIGINS` as a comma-separated list. The same list configures both runtime URL validation and the dashboard's `frame-src` Content Security Policy. Same-origin plugin pages are permitted without configuration. `initializeModuleFederation` also accepts `trustedOrigins` for programmatic configuration; any such origins must additionally be present in the environment variable so CSP permits them.

## Usage

```tsx
import { PluginHost } from "@/src/components/PluginHost";
import { initializeModuleFederation } from "@/src/lib/plugins/federation";

initializeModuleFederation({
  plugins: [myPluginManifest],
});

function Dashboard() {
  return (
    <PluginHost
      pluginId="analytics-widget"
      context={{ workspaceId: "ws-1" }}
    />
  );
}
```

## Plugin API

The plugin document must listen for messages from its parent and send a ready message after it is initialized. Since the iframe has an opaque origin, the ready event's `origin` is `"null"`; the host additionally verifies the exact iframe `WindowProxy`, plugin ID, and version.

```typescript
// In the plugin page
window.parent.postMessage(
  {
    type: "SOROTASK_PLUGIN_READY",
    pluginId: "analytics-widget",
    version: "1.0.0",
  },
  "*",
);

window.addEventListener("message", (event) => {
  const trustedDashboardOrigin = "https://app.sorotask.example";
  if (event.source !== window.parent || event.origin !== trustedDashboardOrigin) {
    return;
  }

  const message = event.data;
  if (
    message?.type === "SOROTASK_PLUGIN_INIT" &&
    message.pluginId === "analytics-widget" &&
    message.version === "1.0.0"
  ) {
    renderWidget(message.context);
  }
});
```

Plugins may report initialization failure with a `SOROTASK_PLUGIN_ERROR` message containing their `pluginId` and a string `message`. The host accepts messages only from the registered iframe and caps context at 64 KiB. Context is explicitly supplied by the host, JSON-serializable, and must not contain wallet credentials, tokens, or other secrets. Manifest `permissions` are descriptive metadata, not a grant of host capabilities.

## Security and resilience

- The iframe uses only the `allow-scripts` sandbox flag; it does not receive same-origin, forms, popups, or top-navigation access.
- External plugin origins must be explicitly allowlisted as HTTPS origins; entries cannot contain URL credentials or fragments.
- `referrerPolicy="no-referrer"` prevents dashboard URLs from being disclosed to the plugin host.
- Plugins are cached after their manifest URL passes validation. Failed primary entries may use a separately validated fallback entry.
- A plugin that does not complete the ready handshake within 10 seconds is removed and reports an error.
- Lifecycle events use `sorotask:plugin-lifecycle`.

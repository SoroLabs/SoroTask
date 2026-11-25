import type {
  FederationConfig,
  LoadedPlugin,
  PluginLifecycleEvent,
  PluginLoadResult,
  PluginManifest,
  PluginStatus,
} from "./types";
import { PLUGIN_EVENT_NAME } from "./types";
import { getPluginRegistry } from "./registry";
import { createSandboxedPluginComponent } from "../pluginRuntime";

function emitLifecycle(event: PluginLifecycleEvent): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<PluginLifecycleEvent>(PLUGIN_EVENT_NAME, {
        detail: event,
      }),
    );
  }
}

function updateStatus(
  pluginId: string,
  status: PluginStatus,
  error?: string,
): void {
  emitLifecycle({
    pluginId,
    status,
    timestamp: new Date().toISOString(),
    error,
  });
}

export function createPluginLoader(config: FederationConfig = {}) {
  const timeoutMs = config.defaultTimeoutMs ?? 10000;
  const pluginCache = new Map<string, LoadedPlugin>();

  const load = async (manifest: PluginManifest): Promise<PluginLoadResult> => {
    const cached = pluginCache.get(manifest.id);
    if (
      cached?.status === "ready" &&
      cached.manifest.entry === manifest.entry &&
      cached.manifest.version === manifest.version
    ) {
      return { plugin: cached, error: null, usedFallback: false };
    }
    if (
      cached?.status === "fallback" &&
      cached.manifest.entry === manifest.fallbackEntry &&
      cached.manifest.version === manifest.version
    ) {
      return {
        plugin: cached,
        error: cached.error ? new Error(cached.error) : null,
        usedFallback: true,
      };
    }

    updateStatus(manifest.id, "loading");

    try {
      const loaded: LoadedPlugin = {
        manifest,
        component: createSandboxedPluginComponent(manifest, {
          defaultTimeoutMs: timeoutMs,
          trustedOrigins: config.trustedOrigins,
        }),
        status: "ready",
        loadedAt: new Date().toISOString(),
      };

      pluginCache.set(manifest.id, loaded);
      updateStatus(manifest.id, "ready");

      return { plugin: loaded, error: null, usedFallback: false };
    } catch (primaryError) {
      const error =
        primaryError instanceof Error
          ? primaryError
          : new Error(String(primaryError));

      config.onLoadError?.(manifest.id, error);

      let loadError = error;
      if (manifest.fallbackEntry) {
        try {
          const fallbackManifest = { ...manifest, entry: manifest.fallbackEntry };

          const loaded: LoadedPlugin = {
            manifest: fallbackManifest,
            component: createSandboxedPluginComponent(fallbackManifest, {
              defaultTimeoutMs: timeoutMs,
              trustedOrigins: config.trustedOrigins,
            }),
            status: "fallback",
            loadedAt: new Date().toISOString(),
            error: error.message,
          };

          pluginCache.set(manifest.id, loaded);
          updateStatus(manifest.id, "fallback", error.message);

          return { plugin: loaded, error, usedFallback: true };
        } catch (fallbackError) {
          const fallbackLoadError =
            fallbackError instanceof Error
              ? fallbackError
              : new Error(String(fallbackError));
          config.onLoadError?.(manifest.id, fallbackLoadError);
          loadError = new Error(
            `Plugin entry failed: ${error.message}; fallback entry failed: ${fallbackLoadError.message}`,
          );
        }
      }

      const failed: LoadedPlugin = {
        manifest,
        component: () => null,
        status: "error",
        loadedAt: new Date().toISOString(),
        error: loadError.message,
      };

      pluginCache.set(manifest.id, failed);
      updateStatus(manifest.id, "error", loadError.message);

      return { plugin: failed, error: loadError, usedFallback: false };
    }
  };

  const loadById = async (pluginId: string): Promise<PluginLoadResult> => {
    const registry = getPluginRegistry();
    const entry = registry.get(pluginId);

    if (!entry) {
      const notFound = new Error(`Plugin "${pluginId}" is not registered`);
      return { plugin: null, error: notFound, usedFallback: false };
    }

    if (!entry.enabled) {
      const disabled = new Error(`Plugin "${pluginId}" is disabled`);
      return { plugin: null, error: disabled, usedFallback: false };
    }

    return load(entry);
  };

  const loadByScope = async (scope: string): Promise<PluginLoadResult[]> => {
    const registry = getPluginRegistry();
    const entries = registry.findByScope(scope);
    return Promise.all(entries.map((entry) => load(entry)));
  };

  const getCached = (pluginId: string): LoadedPlugin | undefined => {
    return pluginCache.get(pluginId);
  };

  const clearCache = (pluginId?: string): void => {
    if (pluginId) {
      pluginCache.delete(pluginId);
    } else {
      pluginCache.clear();
    }
  };

  return {
    load,
    loadById,
    loadByScope,
    getCached,
    clearCache,
  };
}

let globalLoader: ReturnType<typeof createPluginLoader> | null = null;

export function getPluginLoader(
  config?: FederationConfig,
): ReturnType<typeof createPluginLoader> {
  if (!globalLoader) {
    globalLoader = createPluginLoader(config);
  }
  return globalLoader;
}

export function resetPluginLoader(): void {
  globalLoader = null;
}

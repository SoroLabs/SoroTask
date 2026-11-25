import type { PluginManifest, PluginRegistryEntry } from "./types";

const REGISTRY_STORAGE_KEY = "sorotask_plugin_registry";

function readStorage(): PluginRegistryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as PluginRegistryEntry[];
    }
  } catch {
    // Ignore storage failures
  }

  return window.__SOROTASK_PLUGIN_REGISTRY__ ?? [];
}

function writeStorage(entries: PluginRegistryEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.__SOROTASK_PLUGIN_REGISTRY__ = entries;

  try {
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage failures
  }
}

export function createPluginRegistry(initialPlugins: PluginManifest[] = []) {
  const entries = new Map<string, PluginRegistryEntry>();

  for (const stored of readStorage()) {
    entries.set(stored.id, stored);
  }

  for (const manifest of initialPlugins) {
    if (!entries.has(manifest.id)) {
      entries.set(manifest.id, {
        ...manifest,
        registeredAt: new Date().toISOString(),
        enabled: true,
      });
    }
  }

  const persist = () => {
    writeStorage(Array.from(entries.values()));
  };

  const register = (manifest: PluginManifest): PluginRegistryEntry => {
    const entry: PluginRegistryEntry = {
      ...manifest,
      registeredAt: new Date().toISOString(),
      enabled: true,
    };
    entries.set(manifest.id, entry);
    persist();
    return entry;
  };

  const unregister = (pluginId: string): boolean => {
    const removed = entries.delete(pluginId);
    if (removed) {
      persist();
    }
    return removed;
  };

  const get = (pluginId: string): PluginRegistryEntry | undefined => {
    return entries.get(pluginId);
  };

  const list = (options?: { enabledOnly?: boolean }): PluginRegistryEntry[] => {
    const all = Array.from(entries.values());
    if (options?.enabledOnly) {
      return all.filter((entry) => entry.enabled);
    }
    return all;
  };

  const setEnabled = (pluginId: string, enabled: boolean): boolean => {
    const entry = entries.get(pluginId);
    if (!entry) {
      return false;
    }
    entries.set(pluginId, { ...entry, enabled });
    persist();
    return true;
  };

  const findByScope = (scope: string): PluginRegistryEntry[] => {
    return list({ enabledOnly: true }).filter((entry) => entry.scope === scope);
  };

  return {
    register,
    unregister,
    get,
    list,
    setEnabled,
    findByScope,
  };
}

let globalRegistry: ReturnType<typeof createPluginRegistry> | null = null;

export function getPluginRegistry(
  initialPlugins?: PluginManifest[],
): ReturnType<typeof createPluginRegistry> {
  if (!globalRegistry) {
    globalRegistry = createPluginRegistry(initialPlugins);
  }
  return globalRegistry;
}

export function resetPluginRegistry(): void {
  globalRegistry = null;
}

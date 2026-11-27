import type { PluginManifest, PluginRegistryEntry } from "./types";

declare global {
  interface Window {
    __SOROTASK_PLUGIN_REGISTRY__?: PluginRegistryEntry[];
  }
}

const REGISTRY_STORAGE_KEY = "sorotask_plugin_registry";

/**
 * Verified marketplace plugins are identified by a signed-off manifest that
 * declares which origins are allowed to serve them. Entries that do not pass
 * validation are discarded rather than trusted.
 */
function isValidEntry(value: unknown): value is PluginRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.version === "string" &&
    typeof v.entry === "string" &&
    typeof v.scope === "string" &&
    typeof v.registeredAt === "string" &&
    typeof v.enabled === "boolean" &&
    (v.permissions === undefined ||
      (Array.isArray(v.permissions) &&
        v.permissions.every((p) => typeof p === "string")))
  );
}

function readStorage(): PluginRegistryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidEntry);
      }
    }
  } catch {
    // Ignore storage failures
  }

  return (window.__SOROTASK_PLUGIN_REGISTRY__ ?? []).filter(isValidEntry);
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { getPluginLoader } from "@/src/lib/plugins/loader";
import { getPluginRegistry } from "@/src/lib/plugins/registry";
import {
  PLUGIN_EVENT_NAME,
  type LoadedPlugin,
  type PluginLifecycleEvent,
  type PluginRegistryEntry,
} from "@/src/lib/plugins/types";

export function usePluginLoader(scope?: string) {
  const [plugins, setPlugins] = useState<PluginRegistryEntry[]>([]);
  const [loaded, setLoaded] = useState<Map<string, LoadedPlugin>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    const registry = getPluginRegistry();
    const entries = scope ? registry.findByScope(scope) : registry.list({ enabledOnly: true });
    setPlugins(entries);
  }, [scope]);

  useEffect(() => {
    refresh();

    const handleLifecycle = (event: Event) => {
      const detail = (event as CustomEvent<PluginLifecycleEvent>).detail;
      if (scope) {
        const entry = getPluginRegistry().get(detail.pluginId);
        if (entry?.scope !== scope) return;
      }

      if (detail.status === "loading") {
        setLoadingIds((prev) => new Set(prev).add(detail.pluginId));
      } else {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(detail.pluginId);
          return next;
        });

        const cached = getPluginLoader().getCached(detail.pluginId);
        if (cached) {
          setLoaded((prev) => new Map(prev).set(detail.pluginId, cached));
        }
      }
    };

    window.addEventListener(PLUGIN_EVENT_NAME, handleLifecycle);
    return () => window.removeEventListener(PLUGIN_EVENT_NAME, handleLifecycle);
  }, [scope, refresh]);

  const loadPlugin = useCallback(async (pluginId: string) => {
    const result = await getPluginLoader().loadById(pluginId);
    if (result.plugin) {
      setLoaded((prev) => new Map(prev).set(pluginId, result.plugin!));
    }
    return result;
  }, []);

  const loadScope = useCallback(async () => {
    if (!scope) return [];
    const results = await getPluginLoader().loadByScope(scope);
    const nextLoaded = new Map(loaded);
    for (const result of results) {
      if (result.plugin) {
        nextLoaded.set(result.plugin.manifest.id, result.plugin);
      }
    }
    setLoaded(nextLoaded);
    return results;
  }, [scope, loaded]);

  return {
    plugins,
    loaded,
    loadingIds,
    loadPlugin,
    loadScope,
    refresh,
  };
}

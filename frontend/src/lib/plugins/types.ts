import type { ComponentType } from "react";

export type PluginStatus = "idle" | "loading" | "ready" | "error" | "fallback";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: string;
  scope: string;
  permissions?: string[];
  fallbackEntry?: string;
};

export type LoadedPlugin = {
  manifest: PluginManifest;
  component: ComponentType<PluginComponentProps>;
  status: PluginStatus;
  loadedAt: string;
  error?: string;
};

export type PluginComponentProps = {
  pluginId: string;
  context?: Record<string, unknown>;
  onError?: (error: Error) => void;
};

export type PluginLoadResult = {
  plugin: LoadedPlugin | null;
  error: Error | null;
  usedFallback: boolean;
};

export type PluginRegistryEntry = PluginManifest & {
  registeredAt: string;
  enabled: boolean;
};

export type FederationConfig = {
  defaultTimeoutMs?: number;
  trustedOrigins?: string[];
  onLoadError?: (pluginId: string, error: Error) => void;
};

export const PLUGIN_EVENT_NAME = "sorotask:plugin-lifecycle";

export type PluginLifecycleEvent = {
  pluginId: string;
  status: PluginStatus;
  timestamp: string;
  error?: string;
};

declare global {
  interface Window {
    __SOROTASK_PLUGIN_REGISTRY__?: PluginRegistryEntry[];
  }
}

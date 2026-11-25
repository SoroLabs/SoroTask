import {
  getPluginLoader,
  resetPluginLoader,
} from "./loader";
import {
  getPluginRegistry,
  resetPluginRegistry,
} from "./registry";
import type {
  FederationConfig,
  PluginManifest,
  PluginRegistryEntry,
} from "./types";

export type ModuleFederationOptions = FederationConfig & {
  plugins?: PluginManifest[];
};

export function initializeModuleFederation(
  options: ModuleFederationOptions = {},
) {
  resetPluginLoader();
  const registry = getPluginRegistry(options.plugins ?? []);
  const loader = getPluginLoader({
    defaultTimeoutMs: options.defaultTimeoutMs,
    trustedOrigins: options.trustedOrigins,
    onLoadError: options.onLoadError,
  });

  return {
    registry,
    loader,
    registerPlugin: (manifest: PluginManifest): PluginRegistryEntry =>
      registry.register(manifest),
    loadPlugin: (pluginId: string) => loader.loadById(pluginId),
    loadScope: (scope: string) => loader.loadByScope(scope),
    listPlugins: () => registry.list(),
  };
}

export function getModuleFederation() {
  return {
    registry: getPluginRegistry(),
    loader: getPluginLoader(),
  };
}

export function resetModuleFederation(): void {
  resetPluginRegistry();
  resetPluginLoader();
}

export {
  createPluginLoader,
  getPluginLoader,
  resetPluginLoader,
} from "./loader";
export {
  createPluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from "./registry";
export {
  PLUGIN_EVENT_NAME,
  type FederationConfig,
  type LoadedPlugin,
  type PluginComponentProps,
  type PluginLifecycleEvent,
  type PluginLoadResult,
  type PluginManifest,
  type PluginRegistryEntry,
  type PluginStatus,
} from "./types";

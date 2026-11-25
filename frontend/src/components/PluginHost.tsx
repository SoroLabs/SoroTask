"use client";

import { Suspense, useEffect, useState } from "react";
import { getPluginLoader } from "@/src/lib/plugins/loader";
import type {
  LoadedPlugin,
  PluginComponentProps,
} from "@/src/lib/plugins/types";

type PluginHostProps = {
  pluginId: string;
  context?: Record<string, unknown>;
  fallback?: React.ReactNode;
  loadingFallback?: React.ReactNode;
  onError?: (error: Error) => void;
};

export function PluginHost({
  pluginId,
  context,
  fallback = null,
  loadingFallback = <PluginLoadingPlaceholder pluginId={pluginId} />,
  onError,
}: PluginHostProps) {
  const [plugin, setPlugin] = useState<LoadedPlugin | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loader = getPluginLoader();

    loader
      .loadById(pluginId)
      .then((result) => {
        if (cancelled) return;

        if (result.error && !result.plugin) {
          setError(result.error);
          onError?.(result.error);
        } else if (result.plugin) {
          setPlugin(result.plugin);
          if (result.error) {
            onError?.(result.error);
          }
        }
        setIsLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) return;
        const err = loadError instanceof Error ? loadError : new Error(String(loadError));
        setError(err);
        onError?.(err);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pluginId, onError]);

  if (isLoading) {
    return <>{loadingFallback}</>;
  }

  if (error || !plugin || plugin.status === "error") {
    return <>{fallback ?? <PluginErrorPlaceholder pluginId={pluginId} error={error} />}</>;
  }

  const PluginComponent = plugin.component;

  return (
    <Suspense fallback={loadingFallback}>
      <PluginComponent
        pluginId={pluginId}
        context={context}
        onError={onError}
      />
    </Suspense>
  );
}

function PluginLoadingPlaceholder({ pluginId }: { pluginId: string }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400"
      data-testid={`plugin-loading-${pluginId}`}
    >
      Loading plugin…
    </div>
  );
}

function PluginErrorPlaceholder({
  pluginId,
  error,
}: {
  pluginId: string;
  error: Error | null;
}) {
  return (
    <div
      className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100"
      data-testid={`plugin-error-${pluginId}`}
      role="alert"
    >
      Plugin failed to load: {error?.message ?? "Unknown error"}
    </div>
  );
}

export type { PluginComponentProps, PluginHostProps };

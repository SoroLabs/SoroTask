"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { PluginComponentProps, PluginManifest } from "./plugins/types";

const MAX_CONTEXT_BYTES = 64 * 1024;
const DEFAULT_INIT_TIMEOUT_MS = 10_000;
const CONFIGURED_TRUSTED_ORIGINS = (
  process.env.NEXT_PUBLIC_SOROTASK_PLUGIN_ORIGINS ?? ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export type PluginRuntimeConfig = {
  defaultTimeoutMs?: number;
  trustedOrigins?: string[];
};

export function resolvePluginEntry(
  entry: string,
  trustedOrigins: string[] = CONFIGURED_TRUSTED_ORIGINS,
): string {
  if (typeof window === "undefined") {
    throw new Error("Plugins can only be resolved in a browser");
  }

  let url: URL;
  try {
    url = new URL(entry, window.location.href);
  } catch {
    throw new Error("Plugin entry must be a valid URL");
  }

  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.origin === window.location.origin)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Plugin entry must use HTTPS and cannot contain credentials or a fragment");
  }

  const allowedOrigins = new Set([window.location.origin]);
  for (const trustedOrigin of trustedOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(trustedOrigin);
    } catch {
      throw new Error(`Invalid trusted plugin origin "${trustedOrigin}"`);
    }

    if (
      parsedOrigin.protocol !== "https:" ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      throw new Error(
        `Trusted plugin origin "${trustedOrigin}" must be an HTTPS origin without a path`,
      );
    }

    allowedOrigins.add(parsedOrigin.origin);
  }

  if (!allowedOrigins.has(url.origin)) {
    throw new Error(`Plugin origin "${url.origin}" is not trusted`);
  }

  return url.href;
}

export function createSandboxedPluginComponent(
  manifest: PluginManifest,
  config: PluginRuntimeConfig = {},
): ComponentType<PluginComponentProps> {
  const src = resolvePluginEntry(manifest.entry, config.trustedOrigins);
  const timeoutMs = config.defaultTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;

  return function SandboxedPluginFrame({
    pluginId,
    context,
    onError,
  }: PluginComponentProps) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const readyRef = useRef(false);
    const contextRef = useRef(context);
    const onErrorRef = useRef(onError);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      contextRef.current = context;
      onErrorRef.current = onError;
    }, [context, onError]);

    useEffect(() => {
      let timeout: ReturnType<typeof setTimeout>;
      const fail = (message: string) => {
        setError(message);
        onErrorRef.current?.(new Error(message));
        clearTimeout(timeout);
      };

      const handleMessage = (event: MessageEvent) => {
        if (
          event.source !== frameRef.current?.contentWindow ||
          event.origin !== "null" ||
          !event.data ||
          typeof event.data !== "object" ||
          event.data.pluginId !== pluginId
        ) {
          return;
        }

        if (event.data.type === "SOROTASK_PLUGIN_ERROR") {
          const message =
            typeof event.data.message === "string"
              ? event.data.message.slice(0, 500)
              : "Plugin reported an error";
          fail(message);
          return;
        }

        if (
          event.data.type !== "SOROTASK_PLUGIN_READY" ||
          event.data.version !== manifest.version ||
          readyRef.current
        ) {
          return;
        }

        let serializedContext: string;
        try {
          serializedContext = JSON.stringify(contextRef.current ?? {});
        } catch {
          fail("Plugin context must be JSON-serializable");
          return;
        }

        if (new TextEncoder().encode(serializedContext).byteLength > MAX_CONTEXT_BYTES) {
          fail("Plugin context exceeds the 64 KiB limit");
          return;
        }

        readyRef.current = true;
        clearTimeout(timeout);
        frameRef.current?.contentWindow?.postMessage(
          {
            type: "SOROTASK_PLUGIN_INIT",
            pluginId,
            version: manifest.version,
            context: JSON.parse(serializedContext) as Record<string, unknown>,
          },
          "*",
        );
      };

      window.addEventListener("message", handleMessage);
      timeout = setTimeout(() => {
        if (!readyRef.current) {
          fail(`Plugin did not initialize within ${timeoutMs}ms`);
        }
      }, timeoutMs);

      return () => {
        clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
      };
    }, [manifest.version, pluginId, timeoutMs]);

    if (error) {
      return (
        <div role="alert" data-testid={`plugin-error-${pluginId}`}>
          Plugin failed to initialize: {error}
        </div>
      );
    }

    return (
      <iframe
        ref={frameRef}
        src={src}
        title={manifest.name}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        data-testid={`plugin-frame-${pluginId}`}
        style={{ width: "100%", minHeight: 320, border: 0 }}
      />
    );
  };
}

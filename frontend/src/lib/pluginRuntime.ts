"use client";

import { createElement, useEffect, useRef, useState, type ComponentType } from "react";
import type { PluginComponentProps, PluginManifest } from "./plugins/types";

const MAX_CONTEXT_BYTES = 64 * 1024;
const DEFAULT_INIT_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
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

/** Typed postMessage envelope sent from plugin iframes to the host. */
export type PluginToHostMessage =
  | { type: "SOROTASK_PLUGIN_READY"; pluginId: string; version: string }
  | { type: "SOROTASK_PLUGIN_ERROR"; pluginId: string; message?: unknown };

/** Typed postMessage envelope sent from the host to plugin iframes. */
export type HostToPluginMessage = {
  type: "SOROTASK_PLUGIN_INIT";
  pluginId: string;
  version: string;
  context: Record<string, unknown>;
};

/**
 * Runtime validation for inbound plugin messages. Returns a typed message
 * when the payload matches the protocol exactly, otherwise null.
 */
export function parsePluginMessage(
  data: unknown,
  pluginId: string,
): PluginToHostMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const candidate = data as Record<string, unknown>;
  if (candidate.pluginId !== pluginId) {
    return null;
  }

  if (candidate.type === "SOROTASK_PLUGIN_READY") {
    if (typeof candidate.version !== "string") {
      return null;
    }
    return {
      type: "SOROTASK_PLUGIN_READY",
      pluginId,
      version: candidate.version,
    };
  }

  if (candidate.type === "SOROTASK_PLUGIN_ERROR") {
    const message =
      typeof candidate.message === "string"
        ? candidate.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
        : "Plugin reported an error";
    return { type: "SOROTASK_PLUGIN_ERROR", pluginId, message };
  }

  return null;
}

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
  const targetOrigin = new URL(src).origin;
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
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const fail = (message: string) => {
        setError(message);
        onErrorRef.current?.(new Error(message));
        if (timeout !== undefined) clearTimeout(timeout);
      };

      const handleMessage = (event: MessageEvent) => {
        // Sandboxed iframes without allow-same-origin report origin "null";
        // the source window check is the primary binding to this frame.
        if (event.source !== frameRef.current?.contentWindow) {
          return;
        }

        const message = parsePluginMessage(event.data, pluginId);
        if (!message) {
          return;
        }

        if (message.type === "SOROTASK_PLUGIN_ERROR") {
          fail(message.message ?? "Plugin reported an error");
          return;
        }

        if (message.version !== manifest.version || readyRef.current) {
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
        if (timeout !== undefined) clearTimeout(timeout);

        const parsedContext: Record<string, unknown> = JSON.parse(serializedContext);
        const init: HostToPluginMessage = {
          type: "SOROTASK_PLUGIN_INIT",
          pluginId,
          version: manifest.version,
          context: parsedContext,
        };
        // Pin delivery to the validated plugin origin so context never leaks
        // to a different origin if the frame navigates.
        frameRef.current?.contentWindow?.postMessage(init, targetOrigin);
      };

      window.addEventListener("message", handleMessage);
      timeout = setTimeout(() => {
        if (!readyRef.current) {
          fail(`Plugin did not initialize within ${timeoutMs}ms`);
        }
      }, timeoutMs);

      return () => {
        if (timeout !== undefined) clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
      };
    }, [manifest.version, pluginId, timeoutMs]);

    if (error) {
      return createElement(
        "div",
        { role: "alert", "data-testid": `plugin-error-${pluginId}` },
        `Plugin failed to initialize: ${error}`,
      );
    }

    return createElement("iframe", {
      ref: frameRef,
      src,
      title: manifest.name,
      sandbox: "allow-scripts",
      referrerPolicy: "no-referrer",
      loading: "lazy",
      "data-testid": `plugin-frame-${pluginId}`,
      style: { width: "100%", minHeight: 320, border: 0 },
    });
  };
}

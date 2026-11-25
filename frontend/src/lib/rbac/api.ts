import type { Permission } from "@/types/auth";
import {
  RBAC_EVENT_NAME,
  type RbacConnectionState,
  type RbacStateChangeEvent,
} from "./types";

export type RbacApiResponse<T> = {
  data: T | null;
  error: Error | null;
  fromCache: boolean;
  connectionState: RbacConnectionState;
};

export type RbacApiOptions = {
  baseUrl?: string;
  retryAttempts?: number;
  retryDelayMs?: number;
  cacheKey?: string;
};

const DEFAULT_CACHE_KEY = "sorotask_rbac_cache";

function emitStateChange(event: RbacStateChangeEvent): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<RbacStateChangeEvent>(RBAC_EVENT_NAME, {
        detail: event,
      }),
    );
  }
}

function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return (
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("Failed to fetch")
    );
  }
  return false;
}

async function fetchWithRetry(
  url: string,
  attempts: number,
  delayMs: number,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok && response.status >= 500 && attempt < attempts) {
        throw new Error(`Server error: ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError ?? new Error("Request failed");
}

export function createRbacApi(options: RbacApiOptions = {}) {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "";
  const retryAttempts = options.retryAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;

  const fetchPermissions = async (
    userId: string,
  ): Promise<RbacApiResponse<Permission[]>> => {
    const cacheField = `${cacheKey}:permissions:${userId}`;
    const cached = readCache<Permission[]>(cacheField);

    if (!baseUrl) {
      return {
        data: cached,
        error: cached ? null : new Error("API URL not configured"),
        fromCache: Boolean(cached),
        connectionState: cached ? "degraded" : "offline",
      };
    }

    try {
      const response = await fetchWithRetry(
        `${baseUrl}/api/rbac/permissions/${userId}`,
        retryAttempts,
        retryDelayMs,
      );

      if (!response.ok) {
        throw new Error(`RBAC API error: ${response.status}`);
      }

      const data = (await response.json()) as Permission[];
      writeCache(cacheField, data);

      emitStateChange({
        connectionState: "online",
        timestamp: new Date().toISOString(),
      });

      return {
        data,
        error: null,
        fromCache: false,
        connectionState: "online",
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const state: RbacConnectionState = isNetworkError(error)
        ? "offline"
        : "degraded";

      emitStateChange({
        connectionState: state,
        timestamp: new Date().toISOString(),
        error: err.message,
      });

      return {
        data: cached,
        error: err,
        fromCache: Boolean(cached),
        connectionState: state,
      };
    }
  };

  const syncWorkspace = async (
    workspaceId: string,
    payload: unknown,
  ): Promise<RbacApiResponse<{ success: boolean }>> => {
    const cacheField = `${cacheKey}:workspace:${workspaceId}`;

    if (!baseUrl) {
      writeCache(cacheField, payload);
      return {
        data: { success: true },
        error: null,
        fromCache: true,
        connectionState: "degraded",
      };
    }

    try {
      const response = await fetchWithRetry(
        `${baseUrl}/api/rbac/workspaces/${workspaceId}`,
        retryAttempts,
        retryDelayMs,
      );

      if (!response.ok) {
        throw new Error(`Workspace sync error: ${response.status}`);
      }

      const data = (await response.json()) as { success: boolean };
      writeCache(cacheField, payload);

      return {
        data,
        error: null,
        fromCache: false,
        connectionState: "online",
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      writeCache(cacheField, payload);

      return {
        data: { success: false },
        error: err,
        fromCache: true,
        connectionState: isNetworkError(error) ? "offline" : "degraded",
      };
    }
  };

  return {
    fetchPermissions,
    syncWorkspace,
    readCache,
    writeCache,
  };
}

let globalApi: ReturnType<typeof createRbacApi> | null = null;

export function getRbacApi(
  options?: RbacApiOptions,
): ReturnType<typeof createRbacApi> {
  if (!globalApi) {
    globalApi = createRbacApi(options);
  }
  return globalApi;
}

export function resetRbacApi(): void {
  globalApi = null;
}

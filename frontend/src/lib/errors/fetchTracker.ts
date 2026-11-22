/**
 * Instrumented Fetch Wrapper
 *
 * Wraps the native fetch API to automatically:
 * - Add breadcrumbs for all requests
 * - Track errors and failed responses
 * - Capture timing metrics
 * - Attach user context when available
 */

import { trackApiRequest, trackApiError } from "./tracking";
import { telemetry } from "@/src/lib/telemetry";

// Keep reference to original fetch
const originalFetch = typeof window !== "undefined" ? window.fetch : undefined;

export interface FetchOptions extends RequestInit {
  trackMetadata?: Record<string, unknown>;
}

/**
 * Instrumented fetch that tracks all requests and errors
 */
export async function trackedFetch(
  input: RequestInfo | URL,
  init?: FetchOptions
): Promise<Response> {
  // Only run on client-side
  if (typeof window === "undefined") {
    return (originalFetch || fetch)(input, init);
  }

  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method || "GET";

  // Add request breadcrumb
  trackApiRequest(url, method);

  try {
    const response = await (originalFetch || fetch)(input, init);

    // Track response status
    if (response.status >= 400) {
      trackApiRequest(url, method, response.status);
      telemetry.recordNetworkError(url, response.status, `HTTP ${response.status}`);
    }

    return response;
  } catch (error) {
    // Network errors - track them
    const err = error instanceof Error ? error : new Error(String(error));
    trackApiError(url, method, err);
    telemetry.recordNetworkError(url, 0, err.message);

    throw error;
  }
}

/**
 * Auto-instrument fetch if enabled
 * Call this in your app initialization
 */
export function instrumentFetch() {
  if (typeof window === "undefined") return;

  // Override global fetch only on client
  (window as unknown as Record<string, unknown>).fetch = trackedFetch;
}

/**
 * Create a fetch wrapper with automatic authentication
 */
export function createAuthenticatedFetch(
  getAuthHeaders: () => Record<string, string> = () => ({})
) {
  return async (
    input: RequestInfo | URL,
    init?: FetchOptions
  ): Promise<Response> => {
    const authHeaders = getAuthHeaders();

    const mergedInit: FetchOptions = {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...authHeaders,
      },
    };

    return trackedFetch(input, mergedInit);
  };
}

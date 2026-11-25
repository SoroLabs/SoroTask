import type { RscFetchResult, RscPipelineEvent, RscPipelineOptions } from "./types";
import { RSC_PIPELINE_EVENT } from "./types";

function emitPipelineEvent(event: RscPipelineEvent): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<RscPipelineEvent>(RSC_PIPELINE_EVENT, { detail: event }),
    );
  }
}

async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetcher();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  throw lastError ?? new Error("Fetch failed");
}

export async function rscFetch<T>(
  fetcher: () => Promise<T>,
  options: RscPipelineOptions = {},
): Promise<RscFetchResult<T>> {
  const maxRetries = options.maxRetries ?? 2;
  const startedAt = performance.now();

  try {
    const data = await fetchWithRetry(fetcher, maxRetries);
    return {
      data,
      error: null,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.fallbackData !== undefined) {
      return {
        data: options.fallbackData as T,
        error: message,
        fetchedAt: new Date().toISOString(),
        fromCache: true,
      };
    }

    throw error;
  } finally {
    emitPipelineEvent({
      route: options.cacheKey ?? "unknown",
      stage: "server-data",
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  }
}

export function createRscPipeline(defaultOptions: RscPipelineOptions = {}) {
  return {
    fetch: <T>(fetcher: () => Promise<T>, options?: RscPipelineOptions) =>
      rscFetch(fetcher, { ...defaultOptions, ...options }),
  };
}

let globalPipeline: ReturnType<typeof createRscPipeline> | null = null;

export function getRscPipeline(
  options?: RscPipelineOptions,
): ReturnType<typeof createRscPipeline> {
  if (!globalPipeline) {
    globalPipeline = createRscPipeline(options);
  }
  return globalPipeline;
}

export function resetRscPipeline(): void {
  globalPipeline = null;
}

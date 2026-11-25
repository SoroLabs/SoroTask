export interface LargeListDataPipelineOptions {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => Promise<void> | void;
  retryCount?: number;
  onError?: (error: Error) => void;
}

export interface LargeListDataPipeline {
  requestNextPage: () => Promise<boolean>;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function createLargeListDataPipeline(
  options: LargeListDataPipelineOptions,
): LargeListDataPipeline {
  const retryCount = Math.max(0, options.retryCount ?? 1);
  let inFlight = false;

  async function requestNextPage(): Promise<boolean> {
    if (!options.hasMore || options.isLoadingMore || !options.onLoadMore) {
      return false;
    }

    if (inFlight) {
      return false;
    }

    inFlight = true;

    let attempt = 0;
    while (attempt <= retryCount) {
      try {
        await options.onLoadMore();
        inFlight = false;
        return true;
      } catch (error) {
        if (attempt === retryCount) {
          options.onError?.(normalizeError(error));
          inFlight = false;
          return false;
        }
        attempt += 1;
      }
    }

    inFlight = false;
    return false;
  }

  return {
    requestNextPage,
  };
}

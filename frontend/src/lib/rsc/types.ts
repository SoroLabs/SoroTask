export type RscFetchResult<T> = {
  data: T;
  error: string | null;
  fetchedAt: string;
  fromCache: boolean;
};

export type RscPipelineOptions = {
  revalidateSeconds?: number;
  cacheKey?: string;
  fallbackData?: unknown;
  maxRetries?: number;
};

export type RscMigrationStage = "server-data" | "client-island" | "streaming" | "complete";

export type RscRoutePlan = {
  route: string;
  stage: RscMigrationStage;
  serverComponents: string[];
  clientComponents: string[];
};

export const RSC_PIPELINE_EVENT = "sorotask:rsc-pipeline";

export type RscPipelineEvent = {
  route: string;
  stage: RscMigrationStage;
  durationMs: number;
  error?: string;
};

export const BATCH_REPORT_SCHEMA_VERSION = 1 as const;

export type BatchGlobalStatus =
  | "completed"
  | "completed_with_errors"
  | "aborted";

export type BatchArticleStatus = "success" | "failed" | "not_processed";

export type BatchStep = "fetch" | "storage" | "normalization" | "oauth";

export type BatchArticleResult = {
  articleId: string;
  status: BatchArticleStatus;
  step?: BatchStep;
  errorCode?: string;
  reason?: string;
  collectionId?: string;
  bodySha256?: string;
  collectionMetaPath?: string;
  normalizedPath?: string;
  normalizationWarningCount?: number;
};

export type BatchCounters = {
  requested: number;
  collected: number;
  normalized: number;
  failed: number;
  notProcessed: number;
};

export type BatchGlobalError = {
  step: BatchStep;
  code: string;
  message: string;
};

export type BatchReport = {
  schemaVersion: typeof BATCH_REPORT_SCHEMA_VERSION;
  batchId: string;
  startedAtUtc: string;
  finishedAtUtc: string;
  environment: string;
  inputPath: string;
  inputSha256: string;
  requestedArticleIds: string[];
  delayMs: number;
  status: BatchGlobalStatus;
  globalError?: BatchGlobalError;
  results: BatchArticleResult[];
  counters: BatchCounters;
};

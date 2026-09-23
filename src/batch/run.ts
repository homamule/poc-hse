import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchAccessToken } from "../auth.js";
import {
  configForArticle,
  loadOAuthConfig,
  type OAuthConfig,
} from "../config.js";
import { CollectError, isCollectError } from "../errors.js";
import { fetchArticle } from "../legifrance.js";
import { isNormalizeError } from "../normalize/errors.js";
import {
  normalizeCollection,
  type NormalizeCollectionResult,
} from "../normalize/run.js";
import { getProjectRoot } from "../normalize/load.js";
import { saveSuccessfulCollection } from "../storage.js";
import { parseBatchInput } from "./input.js";
import { writeBatchReport } from "./report.js";
import {
  BATCH_REPORT_SCHEMA_VERSION,
  type BatchArticleResult,
  type BatchCounters,
  type BatchGlobalError,
  type BatchGlobalStatus,
  type BatchReport,
} from "./types.js";

export const DEFAULT_BATCH_DELAY_MS = 1000;

export type BatchArticleProgressEvent = {
  index: number;
  total: number;
  result: BatchArticleResult;
};

export type BatchRunOptions = {
  inputPath: string;
  delayMs?: number;
  projectRoot?: string;
  /** Injection tests : config OAuth déjà chargée. */
  oauthConfig?: OAuthConfig;
  /** Injection tests : pause (défaut = setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Injection tests : horodatages / UUID déterministes. */
  now?: () => Date;
  createBatchId?: () => string;
  /** Injection tests : normalisation (défaut = normalizeCollection). */
  normalize?: (input: {
    collectionMetaPath: string;
    projectRoot?: string;
  }) => Promise<NormalizeCollectionResult>;
  /**
   * Progression : appelé dès qu'un résultat d'article est définitif
   * (succès, échec, ou non traité).
   */
  onArticleResult?: (event: BatchArticleProgressEvent) => void;
};
export type BatchRunOutcome = {
  report: BatchReport;
  reportPathRelative: string;
  exitCode: number;
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseDelayMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_BATCH_DELAY_MS;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new CollectError(
      "BATCH_CONFIG_INVALID",
      `delay-ms invalide : "${raw}". Attendu : entier ≥ 0.`,
    );
  }
  return Number.parseInt(raw.trim(), 10);
}

function controlledMessage(error: unknown): { code: string; message: string } {
  if (isCollectError(error) || isNormalizeError(error)) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "UNEXPECTED",
    message: "Erreur inattendue (détails non exposés).",
  };
}

function isContinueFetchError(error: unknown): boolean {
  return (
    isCollectError(error) &&
    (error.code === "NOT_FOUND" || error.code === "INVALID_RESPONSE")
  );
}

function emptyResult(articleId: string): BatchArticleResult {
  return { articleId, status: "not_processed" };
}

function computeCounters(results: BatchArticleResult[]): BatchCounters {
  let collected = 0;
  let normalized = 0;
  let failed = 0;
  let notProcessed = 0;

  for (const result of results) {
    if (result.status === "not_processed") {
      notProcessed += 1;
      continue;
    }
    if (result.collectionId !== undefined) {
      collected += 1;
    }
    if (result.normalizedPath !== undefined) {
      normalized += 1;
    }
    if (result.status === "failed") {
      failed += 1;
    }
  }

  return {
    requested: results.length,
    collected,
    normalized,
    failed,
    notProcessed,
  };
}

function computeGlobalStatus(input: {
  aborted: boolean;
  results: BatchArticleResult[];
}): BatchGlobalStatus {
  if (input.aborted) {
    return "aborted";
  }
  const allSuccess = input.results.every((r) => r.status === "success");
  if (allSuccess) {
    return "completed";
  }
  return "completed_with_errors";
}

function computeExitCode(report: BatchReport): number {
  const allOk =
    report.status === "completed" &&
    report.counters.failed === 0 &&
    report.counters.notProcessed === 0 &&
    report.counters.normalized === report.counters.requested;
  return allOk ? 0 : 1;
}

/**
 * Orchestre un lot séquentiel : OAuth unique, collectes, normalisations, rapport.
 */
export async function runBatch(options: BatchRunOptions): Promise<BatchRunOutcome> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const delayMs = options.delayMs ?? DEFAULT_BATCH_DELAY_MS;
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new CollectError(
      "BATCH_CONFIG_INVALID",
      "delayMs doit être un entier ≥ 0.",
    );
  }

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const createBatchId = options.createBatchId ?? (() => randomUUID());
  const normalizeFn = options.normalize ?? normalizeCollection;
  const onArticleResult = options.onArticleResult;

  const emitArticleResult = (indexZeroBased: number): void => {
    if (onArticleResult === undefined) {
      return;
    }
    const result = results[indexZeroBased];
    if (result === undefined) {
      return;
    }
    onArticleResult({
      index: indexZeroBased + 1,
      total: results.length,
      result: { ...result },
    });
  };

  const inputAbsolute = path.isAbsolute(options.inputPath)
    ? options.inputPath
    : path.resolve(projectRoot, options.inputPath);
  const inputRelative = toPosix(path.relative(projectRoot, inputAbsolute));

  const inputBytes = await readFile(inputAbsolute);
  const inputSha256 = sha256Bytes(inputBytes);

  let inputJson: unknown;
  try {
    inputJson = JSON.parse(inputBytes.toString("utf8")) as unknown;
  } catch {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      "Fichier d'entrée : JSON invalide.",
    );
  }

  const batchInput = parseBatchInput(inputJson);
  const batchId = createBatchId();
  const startedAtUtc = now().toISOString();

  const results: BatchArticleResult[] = batchInput.articleIds.map(emptyResult);
  let aborted = false;
  let globalError: BatchGlobalError | undefined;
  let abortReasonForRest = "Lot arrêté avant traitement de cet article.";

  const oauth = options.oauthConfig ?? loadOAuthConfig();
  let accessToken: string | undefined;

  try {
    accessToken = await fetchAccessToken(oauth);
  } catch (error) {
    aborted = true;
    const controlled = controlledMessage(error);
    globalError = {
      step: "oauth",
      code: controlled.code,
      message: controlled.message,
    };
    abortReasonForRest = "Échec OAuth initial : aucun article n'a été tenté.";
    for (let i = 0; i < results.length; i += 1) {
      results[i]!.status = "not_processed";
      results[i]!.reason = abortReasonForRest;
      emitArticleResult(i);
    }
  }

  if (accessToken !== undefined) {
    for (let i = 0; i < batchInput.articleIds.length; i += 1) {
      const articleId = batchInput.articleIds[i]!;
      const result = results[i]!;

      if (aborted) {
        result.status = "not_processed";
        result.reason = abortReasonForRest;
        emitArticleResult(i);
        continue;
      }

      const articleConfig = configForArticle(oauth, articleId);

      // --- fetch ---
      let fetched;
      try {
        fetched = await fetchArticle(articleConfig, accessToken);
      } catch (error) {
        if (isContinueFetchError(error)) {
          const controlled = controlledMessage(error);
          result.status = "failed";
          result.step = "fetch";
          result.errorCode = controlled.code;
          emitArticleResult(i);
          if (i < batchInput.articleIds.length - 1) {
            await sleep(delayMs);
          }
          continue;
        }

        aborted = true;
        const controlled = controlledMessage(error);
        globalError = {
          step: "fetch",
          code: controlled.code,
          message: controlled.message,
        };
        result.status = "failed";
        result.step = "fetch";
        result.errorCode = controlled.code;
        abortReasonForRest =
          "Lot arrêté après une erreur fetch bloquante (AUTH, QUOTA, NETWORK ou HTTP).";
        emitArticleResult(i);
        for (let j = i + 1; j < results.length; j += 1) {
          results[j]!.status = "not_processed";
          results[j]!.reason = abortReasonForRest;
          emitArticleResult(j);
        }
        break;
      }

      // --- storage ---
      let saved;
      try {
        saved = await saveSuccessfulCollection({
          bodyText: fetched.bodyText,
          environment: oauth.env,
          requestedArticleId: articleId,
          url: fetched.url,
          httpStatus: fetched.httpStatus,
          dataDir: path.join(projectRoot, "data"),
        });
      } catch (error) {
        aborted = true;
        const controlled = controlledMessage(error);
        globalError = {
          step: "storage",
          code: controlled.code,
          message: controlled.message,
        };
        result.status = "failed";
        result.step = "storage";
        result.errorCode = controlled.code;
        abortReasonForRest =
          "Lot arrêté après une erreur de stockage.";
        emitArticleResult(i);
        for (let j = i + 1; j < results.length; j += 1) {
          results[j]!.status = "not_processed";
          results[j]!.reason = abortReasonForRest;
          emitArticleResult(j);
        }
        break;
      }

      result.collectionId = saved.collectionId;
      result.bodySha256 = saved.sha256;
      result.collectionMetaPath = saved.metadata.collectionMetaPath;

      // --- normalization (chemin exact des métadonnées venant d'être créées) ---
      try {
        const normalized = await normalizeFn({
          collectionMetaPath: saved.metadata.collectionMetaPath,
          projectRoot,
        });
        result.normalizedPath = normalized.outputPathRelative;
        result.normalizationWarningCount = normalized.document.warnings.length;
        result.status = "success";
        emitArticleResult(i);
      } catch (error) {
        aborted = true;
        const controlled = controlledMessage(error);
        globalError = {
          step: "normalization",
          code: controlled.code,
          message: controlled.message,
        };
        result.status = "failed";
        result.step = "normalization";
        result.errorCode = controlled.code;
        abortReasonForRest =
          "Lot arrêté après un échec de normalisation (collecte conservée).";
        emitArticleResult(i);
        for (let j = i + 1; j < results.length; j += 1) {
          results[j]!.status = "not_processed";
          results[j]!.reason = abortReasonForRest;
          emitArticleResult(j);
        }
        break;
      }

      if (i < batchInput.articleIds.length - 1) {
        await sleep(delayMs);
      }
    }
  }

  const finishedAtUtc = now().toISOString();
  const counters = computeCounters(results);
  const status = computeGlobalStatus({ aborted, results });

  const report: BatchReport = {
    schemaVersion: BATCH_REPORT_SCHEMA_VERSION,
    batchId,
    startedAtUtc,
    finishedAtUtc,
    environment: oauth.env,
    inputPath: inputRelative,
    inputSha256,
    requestedArticleIds: [...batchInput.articleIds],
    delayMs,
    status,
    results,
    counters,
  };

  if (globalError !== undefined) {
    report.globalError = globalError;
  }

  const written = await writeBatchReport({ report, projectRoot });
  return {
    report,
    reportPathRelative: written.relative,
    exitCode: computeExitCode(report),
  };
}

export function formatBatchProgressLine(input: {
  index: number;
  total: number;
  result: BatchArticleResult;
}): string {
  const prefix = `[${input.index}/${input.total}] ${input.result.articleId}`;
  if (input.result.status === "success") {
    return `${prefix} — collecté et normalisé`;
  }
  if (input.result.status === "not_processed") {
    return `${prefix} — non traité`;
  }
  const step = input.result.step ?? "fetch";
  const code = input.result.errorCode ?? "ERROR";
  return `${prefix} — échec ${step} : ${code}`;
}

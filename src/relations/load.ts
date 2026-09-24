import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BATCH_REPORT_SCHEMA_VERSION,
  type BatchArticleResult,
  type BatchReport,
} from "../batch/types.js";
import { getProjectRoot } from "../normalize/load.js";
import {
  NORMALIZER_SCHEMA_VERSION,
  type NormalizedArticleDocument,
} from "../normalize/types.js";
import { RelationsError } from "./errors.js";
import { PREVENTION_CORPUS_SIZE } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveUnderProject(
  projectRoot: string,
  relativeOrAbsolute: string,
  label: string,
): { absolute: string; relative: string } {
  const absolute = path.isAbsolute(relativeOrAbsolute)
    ? path.normalize(relativeOrAbsolute)
    : path.resolve(projectRoot, relativeOrAbsolute);
  const relative = toPosix(path.relative(projectRoot, absolute));
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative === ""
  ) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `Chemin hors projet ou invalide (${label}) : ${relativeOrAbsolute}`,
    );
  }
  return { absolute, relative };
}

function parseBatchReport(raw: unknown): BatchReport {
  if (!isPlainObject(raw)) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      "Rapport de lot invalide : objet JSON attendu.",
    );
  }
  if (raw.schemaVersion !== BATCH_REPORT_SCHEMA_VERSION) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `schemaVersion du rapport invalide (attendu ${BATCH_REPORT_SCHEMA_VERSION}).`,
    );
  }
  if (typeof raw.batchId !== "string" || !raw.batchId.trim()) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      "batchId manquant ou invalide.",
    );
  }
  if (!Array.isArray(raw.results)) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      "results doit être un tableau.",
    );
  }
  return raw as unknown as BatchReport;
}

function assertSuccessResult(
  result: BatchArticleResult,
  index: number,
): asserts result is BatchArticleResult & {
  status: "success";
  collectionId: string;
  normalizedPath: string;
  articleId: string;
} {
  if (result.status !== "success") {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `Rapport incomplet : results[${index}] n'est pas en succès (status=${result.status}).`,
    );
  }
  if (typeof result.articleId !== "string" || !result.articleId.trim()) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `results[${index}].articleId manquant.`,
    );
  }
  if (typeof result.collectionId !== "string" || !result.collectionId.trim()) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `results[${index}].collectionId manquant.`,
    );
  }
  if (
    typeof result.normalizedPath !== "string" ||
    !result.normalizedPath.trim()
  ) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `results[${index}].normalizedPath manquant.`,
    );
  }
}

export type LoadedCorpusArticle = {
  batchResult: BatchArticleResult & {
    status: "success";
    collectionId: string;
    normalizedPath: string;
    articleId: string;
  };
  normalizedPathRelative: string;
  normalizedPathAbsolute: string;
  document: NormalizedArticleDocument;
};

export type LoadedBatchCorpus = {
  batch: BatchReport;
  batchPathRelative: string;
  batchPathAbsolute: string;
  articles: LoadedCorpusArticle[];
};

function assertNormalizedMatchesBatch(
  document: NormalizedArticleDocument,
  result: LoadedCorpusArticle["batchResult"],
  normalizedPathRelative: string,
): void {
  if (document.schemaVersion !== NORMALIZER_SCHEMA_VERSION) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `schemaVersion incohérent dans ${normalizedPathRelative} (attendu ${NORMALIZER_SCHEMA_VERSION}).`,
    );
  }
  if (document.provenance.collectionId !== result.collectionId) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `provenance.collectionId incohérent dans ${normalizedPathRelative} (${document.provenance.collectionId} vs ${result.collectionId}).`,
    );
  }
  if (document.provenance.requestedArticleId !== result.articleId) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `provenance.requestedArticleId incohérent dans ${normalizedPathRelative} (${document.provenance.requestedArticleId} vs ${result.articleId}).`,
    );
  }
  if (document.identity.id !== result.articleId) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `identity.id incohérent dans ${normalizedPathRelative} (${document.identity.id} vs ${result.articleId}).`,
    );
  }
}

/**
 * Charge le rapport de lot et les quatre fichiers normalisés succès.
 * Refuse tout rapport incomplet ou fichier incohérent.
 */
export async function loadPreventionBatchCorpus(input: {
  batchPath: string;
  projectRoot?: string;
}): Promise<LoadedBatchCorpus> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const batchResolved = resolveUnderProject(
    projectRoot,
    input.batchPath,
    "batch",
  );

  let batchRaw: unknown;
  try {
    const text = await readFile(batchResolved.absolute, "utf8");
    batchRaw = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof RelationsError) throw error;
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `Impossible de lire le rapport de lot : ${batchResolved.relative}`,
    );
  }

  const batch = parseBatchReport(batchRaw);

  if (batch.results.length !== PREVENTION_CORPUS_SIZE) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `Rapport incomplet : ${PREVENTION_CORPUS_SIZE} résultats attendus, ${batch.results.length} trouvé(s).`,
    );
  }

  const articles: LoadedCorpusArticle[] = [];

  for (let i = 0; i < batch.results.length; i += 1) {
    const result = batch.results[i]!;
    assertSuccessResult(result, i);

    const normalizedResolved = resolveUnderProject(
      projectRoot,
      result.normalizedPath,
      `results[${i}].normalizedPath`,
    );

    let document: NormalizedArticleDocument;
    try {
      const text = await readFile(normalizedResolved.absolute, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isPlainObject(parsed)) {
        throw new RelationsError(
          "RELATIONS_INPUT_INVALID",
          `Document normalisé invalide : ${normalizedResolved.relative}`,
        );
      }
      document = parsed as unknown as NormalizedArticleDocument;
    } catch (error) {
      if (error instanceof RelationsError) throw error;
      throw new RelationsError(
        "RELATIONS_INPUT_INVALID",
        `Impossible de lire le document normalisé : ${normalizedResolved.relative}`,
      );
    }

    assertNormalizedMatchesBatch(
      document,
      result,
      normalizedResolved.relative,
    );

    articles.push({
      batchResult: result,
      normalizedPathRelative: normalizedResolved.relative,
      normalizedPathAbsolute: normalizedResolved.absolute,
      document,
    });
  }

  return {
    batch,
    batchPathRelative: batchResolved.relative,
    batchPathAbsolute: batchResolved.absolute,
    articles,
  };
}

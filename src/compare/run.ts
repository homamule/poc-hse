import { createHash } from "node:crypto";
import path from "node:path";
import { isNormalizeError } from "../normalize/errors.js";
import {
  getProjectRoot,
  loadCollectionForNormalize,
  type LoadedCollection,
} from "../normalize/load.js";
import {
  isPublishError,
  publishExclusiveTextFile,
} from "../publish.js";
import {
  structuralSha256,
  watchSha256,
  stableStringify,
  canonicalize,
} from "./canonicalize.js";
import { diffJson } from "./diff.js";
import { CompareError } from "./errors.js";
import {
  COMPARISON_POLICY_VERSION,
  COMPARISON_SCHEMA_VERSION,
  type CategoryCounters,
  type ComparisonReport,
  type ComparisonStatus,
  type DiffCategory,
  type SideFingerprints,
  type SideProvenance,
  type StructuralDifference,
} from "./types.js";

export type CompareRunOptions = {
  beforeMetaPath: string;
  afterMetaPath: string;
  projectRoot?: string;
};

export type CompareRunOutcome = {
  report: ComparisonReport;
  reportPathRelative: string;
  reportPathAbsolute: string;
  publishStatus: "written" | "already_identical";
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function mapLoadError(error: unknown): never {
  if (isNormalizeError(error)) {
    throw new CompareError(error.code, error.message, error.exitCode);
  }
  throw error;
}

function parseCollectedAtUtc(raw: string, label: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new CompareError(
      "COMPARE_INPUT_INVALID",
      `Horodatage collectedAtUtc invalide (${label}) : ${raw}`,
    );
  }
  return ms;
}

function emptyCounters(): CategoryCounters {
  return {
    content: 0,
    dates_state: 0,
    identity: 0,
    context: 0,
    versions: 0,
    relations: 0,
    technical: 0,
    other: 0,
    total: 0,
  };
}

function tallyCounters(differences: StructuralDifference[]): CategoryCounters {
  const counters = emptyCounters();
  for (const diff of differences) {
    counters[diff.category] += 1;
    counters.total += 1;
  }
  return counters;
}

function computeStatus(input: {
  bodyShaEqual: boolean;
  structuralEqual: boolean;
  differences: StructuralDifference[];
}): ComparisonStatus {
  if (input.bodyShaEqual) {
    return "identical";
  }
  if (input.structuralEqual) {
    return "serialization_only";
  }
  if (input.differences.length === 0) {
    // Corps différents mais structure égale déjà couverte ; sécurité
    return "serialization_only";
  }
  const allTechnical = input.differences.every((d) => d.category === "technical");
  if (allTechnical) {
    return "technical_only";
  }
  return "review_required";
}

function sideProvenance(loaded: LoadedCollection): SideProvenance {
  const articleId =
    typeof loaded.article.id === "string"
      ? loaded.article.id
      : loaded.metadata.requestedArticleId;
  return {
    collectionId: loaded.metadata.collectionId,
    collectedAtUtc: loaded.metadata.collectedAtUtc,
    environment: String(loaded.metadata.environment),
    collectionMetaPath: loaded.metadataPathRelative,
    bodyPath: loaded.bodyPathRelative,
    articleId,
  };
}

function sideFingerprints(
  loaded: LoadedCollection,
): SideFingerprints {
  return {
    bodySha256: loaded.metadata.bodySha256,
    structuralSha256: structuralSha256(loaded.bodyJson),
    watchSha256: watchSha256(loaded.bodyJson),
  };
}

function buildComparisonId(input: {
  before: SideProvenance & { bodySha256: string };
  after: SideProvenance & { bodySha256: string };
}): string {
  const payload = canonicalize({
    comparisonPolicyVersion: COMPARISON_POLICY_VERSION,
    before: {
      collectionId: input.before.collectionId,
      collectedAtUtc: input.before.collectedAtUtc,
      environment: input.before.environment,
      collectionMetaPath: input.before.collectionMetaPath,
      bodyPath: input.before.bodyPath,
      articleId: input.before.articleId,
      bodySha256: input.before.bodySha256,
    },
    after: {
      collectionId: input.after.collectionId,
      collectedAtUtc: input.after.collectedAtUtc,
      environment: input.after.environment,
      collectionMetaPath: input.after.collectionMetaPath,
      bodyPath: input.after.bodyPath,
      articleId: input.after.articleId,
      bodySha256: input.after.bodySha256,
    },
  });
  return createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

function assertComparablePair(
  before: LoadedCollection,
  after: LoadedCollection,
): void {
  const beforeId =
    typeof before.article.id === "string" ? before.article.id : null;
  const afterId =
    typeof after.article.id === "string" ? after.article.id : null;

  if (beforeId === null || afterId === null) {
    throw new CompareError(
      "COMPARE_INPUT_INVALID",
      "article.id manquant sur l'un des corps.",
    );
  }
  if (beforeId !== afterId) {
    throw new CompareError(
      "COMPARE_INPUT_INVALID",
      `Identifiants d'article différents (${beforeId} vs ${afterId}). La comparaison inter-versions LEGIARTI est hors périmètre.`,
    );
  }
  if (
    String(before.metadata.environment) !== String(after.metadata.environment)
  ) {
    throw new CompareError(
      "COMPARE_INPUT_INVALID",
      `Environnements différents (${before.metadata.environment} vs ${after.metadata.environment}).`,
    );
  }

  const beforeMs = parseCollectedAtUtc(
    before.metadata.collectedAtUtc,
    "before",
  );
  const afterMs = parseCollectedAtUtc(after.metadata.collectedAtUtc, "after");
  if (beforeMs > afterMs) {
    throw new CompareError(
      "COMPARE_INPUT_INVALID",
      "Ordre chronologique invalide : before.collectedAtUtc doit être ≤ after.collectedAtUtc.",
    );
  }
}

export function serializeComparisonReport(report: ComparisonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeComparisonReport(input: {
  report: ComparisonReport;
  projectRoot?: string;
}): Promise<{
  absolute: string;
  relative: string;
  publishStatus: "written" | "already_identical";
}> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const relative = `data/comparisons/${input.report.comparisonId}.json`;
  const absolute = path.join(projectRoot, relative);
  const content = serializeComparisonReport(input.report);

  try {
    const published = await publishExclusiveTextFile({
      content,
      destinationAbsolute: absolute,
      destinationLabel: toPosix(relative),
    });
    return {
      absolute,
      relative: toPosix(relative),
      publishStatus:
        published.status === "already_identical"
          ? "already_identical"
          : "written",
    };
  } catch (error) {
    if (isPublishError(error)) {
      throw new CompareError(error.code, error.message, error.exitCode);
    }
    throw error;
  }
}

/**
 * Compare deux collectes (corps JSON originaux) de façon déterministe.
 */
export async function runCompare(
  options: CompareRunOptions,
): Promise<CompareRunOutcome> {
  const projectRoot = options.projectRoot ?? getProjectRoot();

  let before: LoadedCollection;
  let after: LoadedCollection;
  try {
    before = await loadCollectionForNormalize(options.beforeMetaPath, {
      projectRoot,
    });
    after = await loadCollectionForNormalize(options.afterMetaPath, {
      projectRoot,
    });
  } catch (error) {
    mapLoadError(error);
  }

  assertComparablePair(before, after);

  const beforeProv = sideProvenance(before);
  const afterProv = sideProvenance(after);
  const beforeFp = sideFingerprints(before);
  const afterFp = sideFingerprints(after);

  const bodyShaEqual = beforeFp.bodySha256 === afterFp.bodySha256;
  const structuralEqual =
    beforeFp.structuralSha256 === afterFp.structuralSha256;

  const differences = bodyShaEqual
    ? []
    : structuralEqual
      ? []
      : diffJson(before.bodyJson, after.bodyJson);

  const status = computeStatus({
    bodyShaEqual,
    structuralEqual,
    differences,
  });
  const counters = tallyCounters(differences);

  const comparisonId = buildComparisonId({
    before: { ...beforeProv, bodySha256: beforeFp.bodySha256 },
    after: { ...afterProv, bodySha256: afterFp.bodySha256 },
  });

  const report: ComparisonReport = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    comparisonPolicyVersion: COMPARISON_POLICY_VERSION,
    comparisonId,
    before: { ...beforeProv, ...beforeFp },
    after: { ...afterProv, ...afterFp },
    status,
    differences,
    counters,
  };

  const written = await writeComparisonReport({ report, projectRoot });

  return {
    report,
    reportPathRelative: written.relative,
    reportPathAbsolute: written.absolute,
    publishStatus: written.publishStatus,
  };
}

export function summarizeDifferencePaths(
  differences: StructuralDifference[],
): string[] {
  return differences.map((d) => d.path);
}

export type { DiffCategory };

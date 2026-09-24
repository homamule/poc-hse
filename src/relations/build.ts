import { createHash } from "node:crypto";
import { canonicalize, stableStringify } from "../compare/canonicalize.js";
import type { LoadedBatchCorpus, LoadedCorpusArticle } from "./load.js";
import {
  buildResolutionLookup,
  classifyReference,
} from "./classify.js";
import {
  RELATION_FAMILIES,
  RELATION_INVENTORY_POLICY_VERSION,
  RELATION_INVENTORY_SCHEMA_VERSION,
  type CorpusArticleFingerprint,
  type FamilyCounters,
  type RelationFamily,
  type RelationInventoryEntry,
  type RelationInventoryReport,
  type RelationSourceFields,
  type ResolutionCounters,
} from "./types.js";
import { RelationsError } from "./errors.js";

const SOURCE_FIELD_KEYS = [
  "textCid",
  "textTitle",
  "natureText",
  "parentCid",
  "numTexte",
  "datePubli",
  "dateDebut",
  "datePubliTexte",
  "dateSignaTexte",
  "dateDebutCible",
] as const;

function emptyFamilyCounters(): FamilyCounters {
  return {
    lienCitations: 0,
    lienModifications: 0,
    lienConcordes: 0,
    lienAutres: 0,
  };
}

function emptyResolutionCounters(): ResolutionCounters {
  return {
    version_collectee: 0,
    autre_version_connue: 0,
    non_resolue: 0,
  };
}

function asNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function extractSourceFields(raw: Record<string, unknown>): RelationSourceFields {
  const out: RelationSourceFields = {};
  for (const key of SOURCE_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key];
    }
  }
  return out;
}

function relationArray(
  document: LoadedCorpusArticle["document"],
  family: RelationFamily,
  normalizedPath: string,
): unknown[] {
  const value = document.relations[family];
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RelationsError(
      "RELATIONS_INPUT_INVALID",
      `relations.${family} n'est pas un tableau dans ${normalizedPath}.`,
    );
  }
  return value;
}

function inventoryEntryFromRaw(input: {
  article: LoadedCorpusArticle;
  family: RelationFamily;
  index: number;
  raw: unknown;
  lookup: ReturnType<typeof buildResolutionLookup>;
}): RelationInventoryEntry {
  const { article, family, index, lookup } = input;
  const rawObj =
    input.raw !== null &&
    typeof input.raw === "object" &&
    !Array.isArray(input.raw)
      ? (input.raw as Record<string, unknown>)
      : {};

  const articleIdRaw = Object.prototype.hasOwnProperty.call(rawObj, "articleId")
    ? rawObj.articleId
    : undefined;
  const classified = classifyReference(articleIdRaw, lookup);

  const resolution: RelationInventoryEntry["resolution"] = {
    class: classified.class,
  };
  if (classified.reason !== undefined) {
    resolution.reason = classified.reason;
  }
  if (classified.matchedCollectionId !== undefined) {
    resolution.matchedCollectionId = classified.matchedCollectionId;
  }

  return {
    source: {
      articleId: article.document.identity.id as string,
      articleNum: article.document.identity.num,
      collectionId: article.document.provenance.collectionId,
    },
    family,
    index,
    articleId: asNullableString(articleIdRaw),
    articleNum: asNullableString(rawObj.articleNum),
    linkType: Object.prototype.hasOwnProperty.call(rawObj, "linkType")
      ? rawObj.linkType
      : null,
    linkOrientation: Object.prototype.hasOwnProperty.call(
      rawObj,
      "linkOrientation",
    )
      ? rawObj.linkOrientation
      : null,
    sourceFields: extractSourceFields(rawObj),
    resolution,
    pointer: {
      normalizedPath: article.normalizedPathRelative,
      family,
      index,
    },
  };
}

export function buildCorpusFingerprints(
  articles: LoadedCorpusArticle[],
): CorpusArticleFingerprint[] {
  return articles.map((article) => ({
    collectionId: article.document.provenance.collectionId,
    articleId: article.document.identity.id as string,
    articleNum: article.document.identity.num,
    bodySha256: article.document.provenance.bodySha256,
    normalizedPath: article.normalizedPathRelative,
  }));
}

export function buildInventoryId(input: {
  batchId: string;
  corpus: CorpusArticleFingerprint[];
}): string {
  const payload = canonicalize({
    inventoryPolicyVersion: RELATION_INVENTORY_POLICY_VERSION,
    batchId: input.batchId,
    corpus: input.corpus.map((c) => ({
      collectionId: c.collectionId,
      articleId: c.articleId,
      bodySha256: c.bodySha256,
      normalizedPath: c.normalizedPath,
    })),
  });
  return createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

/**
 * Construit l'inventaire déterministe des relations du corpus chargé.
 */
export function buildRelationInventory(
  loaded: LoadedBatchCorpus,
): RelationInventoryReport {
  const lookup = buildResolutionLookup(loaded.articles);
  const entries: RelationInventoryEntry[] = [];

  for (const article of loaded.articles) {
    for (const family of RELATION_FAMILIES) {
      const arr = relationArray(
        article.document,
        family,
        article.normalizedPathRelative,
      );
      for (let index = 0; index < arr.length; index += 1) {
        entries.push(
          inventoryEntryFromRaw({
            article,
            family,
            index,
            raw: arr[index],
            lookup,
          }),
        );
      }
    }
  }

  // Ordre déterministe : ordre corpus (batch) × famille × index (déjà respecté).
  const byFamily = emptyFamilyCounters();
  const byResolution = emptyResolutionCounters();
  for (const entry of entries) {
    byFamily[entry.family] += 1;
    byResolution[entry.resolution.class] += 1;
  }

  const corpus = buildCorpusFingerprints(loaded.articles);
  const inventoryId = buildInventoryId({
    batchId: loaded.batch.batchId,
    corpus,
  });

  return {
    schemaVersion: RELATION_INVENTORY_SCHEMA_VERSION,
    inventoryPolicyVersion: RELATION_INVENTORY_POLICY_VERSION,
    inventoryId,
    batchId: loaded.batch.batchId,
    batchPath: loaded.batchPathRelative,
    corpus,
    counters: {
      total: entries.length,
      byFamily,
      byResolution,
    },
    entries,
  };
}

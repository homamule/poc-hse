import type { LoadedCorpusArticle } from "./load.js";
import type { ResolutionClass } from "./types.js";

export type ResolutionLookup = {
  /** identity.id → collectionId (versions effectivement collectées). */
  collectedById: Map<string, string>;
  /** ids figurant dans versions.articleVersions d'au moins un article du corpus. */
  knownVersionIds: Set<string>;
};

/**
 * Construit les index de résolution par correspondance exacte d'identifiant.
 * Jamais d'appariement sur num ou cid.
 */
export function buildResolutionLookup(
  articles: LoadedCorpusArticle[],
): ResolutionLookup {
  const collectedById = new Map<string, string>();
  const knownVersionIds = new Set<string>();

  for (const article of articles) {
    const id = article.document.identity.id;
    if (typeof id === "string" && id.length > 0) {
      collectedById.set(id, article.document.provenance.collectionId);
    }

    const versions = article.document.versions.articleVersions;
    if (!Array.isArray(versions)) {
      continue;
    }
    for (const entry of versions) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { id?: unknown }).id === "string"
      ) {
        const versionId = (entry as { id: string }).id;
        if (versionId.length > 0) {
          knownVersionIds.add(versionId);
        }
      }
    }
  }

  return { collectedById, knownVersionIds };
}

export type ClassifiedReference = {
  class: ResolutionClass;
  reason?: string;
  matchedCollectionId?: string;
};

/**
 * Classe une référence articleId (valeur brute).
 * Conservée même absente / inattendue → non_resolue avec raison.
 */
export function classifyReference(
  articleIdRaw: unknown,
  lookup: ResolutionLookup,
): ClassifiedReference {
  if (articleIdRaw === undefined || articleIdRaw === null) {
    return { class: "non_resolue", reason: "articleId_absent" };
  }
  if (typeof articleIdRaw !== "string") {
    return { class: "non_resolue", reason: "articleId_type_inattendu" };
  }
  if (articleIdRaw.length === 0) {
    return { class: "non_resolue", reason: "articleId_vide" };
  }

  const matchedCollectionId = lookup.collectedById.get(articleIdRaw);
  if (matchedCollectionId !== undefined) {
    return {
      class: "version_collectee",
      matchedCollectionId,
    };
  }

  if (lookup.knownVersionIds.has(articleIdRaw)) {
    return { class: "autre_version_connue" };
  }

  return {
    class: "non_resolue",
    reason: "articleId_hors_corpus_et_versions",
  };
}

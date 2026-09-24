export const RELATION_INVENTORY_SCHEMA_VERSION = 1 as const;
export const RELATION_INVENTORY_POLICY_VERSION = "1.0.0" as const;

/** Nombre d'articles success attendus pour le corpus de prévention. */
export const PREVENTION_CORPUS_SIZE = 4 as const;

export const RELATION_FAMILIES = [
  "lienCitations",
  "lienModifications",
  "lienConcordes",
  "lienAutres",
] as const;

export type RelationFamily = (typeof RELATION_FAMILIES)[number];

export type ResolutionClass =
  | "version_collectee"
  | "autre_version_connue"
  | "non_resolue";

export type RelationSourceArticle = {
  articleId: string;
  articleNum: string | null;
  collectionId: string;
};

export type RelationPointer = {
  normalizedPath: string;
  family: RelationFamily;
  index: number;
};

export type RelationResolution = {
  class: ResolutionClass;
  /** Raison explicite lorsque class === non_resolue. */
  reason?: string;
  /** collectionId de l'article du corpus dont identity.id correspond. */
  matchedCollectionId?: string;
};

/**
 * Champs source utiles conservés bruts (hors champs déjà remontés).
 * Aucune interprétation de linkOrientation.
 */
export type RelationSourceFields = {
  textCid?: unknown;
  textTitle?: unknown;
  natureText?: unknown;
  parentCid?: unknown;
  numTexte?: unknown;
  datePubli?: unknown;
  dateDebut?: unknown;
  datePubliTexte?: unknown;
  dateSignaTexte?: unknown;
  dateDebutCible?: unknown;
};

export type RelationInventoryEntry = {
  source: RelationSourceArticle;
  family: RelationFamily;
  index: number;
  articleId: string | null;
  articleNum: string | null;
  linkType: unknown;
  linkOrientation: unknown;
  sourceFields: RelationSourceFields;
  resolution: RelationResolution;
  pointer: RelationPointer;
};

export type FamilyCounters = Record<RelationFamily, number>;

export type ResolutionCounters = Record<ResolutionClass, number>;

export type CorpusArticleFingerprint = {
  collectionId: string;
  articleId: string;
  articleNum: string | null;
  bodySha256: string;
  normalizedPath: string;
};

export type RelationInventoryReport = {
  schemaVersion: typeof RELATION_INVENTORY_SCHEMA_VERSION;
  inventoryPolicyVersion: typeof RELATION_INVENTORY_POLICY_VERSION;
  inventoryId: string;
  batchId: string;
  batchPath: string;
  corpus: CorpusArticleFingerprint[];
  counters: {
    total: number;
    byFamily: FamilyCounters;
    byResolution: ResolutionCounters;
  };
  entries: RelationInventoryEntry[];
};

import type {
  RelationFamily,
  RelationPointer,
  ResolutionClass,
} from "../relations/types.js";

export const GRAPH_SCHEMA_VERSION = 1 as const;
export const GRAPH_POLICY_VERSION = "1.0.0" as const;

export type GraphLinkType = "OBSERVATION_DANS" | "REFERENCE_IDENTIFIANT";

export type CollectedArticleVersionNode = {
  kind: "ArticleVersion";
  id: string;
  collected: true;
  num: string | null;
  cid: string | null;
  /** État tel que présent dans le document normalisé source. */
  etat: string | null;
  collectionId: string;
  bodySha256: string;
  normalizedPath: string;
};

/**
 * Version historique connue via articleVersions / inventaire,
 * sans texte, état ni date inventés.
 */
export type HistoricalArticleVersionNode = {
  kind: "ArticleVersion";
  id: string;
  collected: false;
  /** Numéro observé sur l'entrée d'inventaire, s'il est une chaîne. */
  articleNum: string | null;
};

export type ArticleVersionNode =
  | CollectedArticleVersionNode
  | HistoricalArticleVersionNode;

export type RelationSourceNode = {
  kind: "RelationSource";
  id: string;
  inventoryId: string;
  sourceCollectionId: string;
  family: RelationFamily;
  index: number;
  linkType: unknown;
  linkOrientation: unknown;
  resolutionClass: Exclude<ResolutionClass, "non_resolue">;
  referencedArticleId: string;
  pointer: RelationPointer;
};

export type GraphLink = {
  type: GraphLinkType;
  from: string;
  to: string;
};

export type GraphDocument = {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  graphPolicyVersion: typeof GRAPH_POLICY_VERSION;
  graphId: string;
  inventoryId: string;
  inventoryPath: string;
  metadata: {
    articleVersionsCollected: number;
    articleVersionsHistorical: number;
    relationSources: number;
    links: number;
    /** Relations inventoriées non projetées (classe non_resolue). */
    nonResolueCount: number;
    projectedEntryCount: number;
  };
  nodes: {
    articleVersions: ArticleVersionNode[];
    relationSources: RelationSourceNode[];
  };
  links: GraphLink[];
};

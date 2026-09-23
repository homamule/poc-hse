export const COMPARISON_SCHEMA_VERSION = 1 as const;
export const COMPARISON_POLICY_VERSION = "1.0.0" as const;

export type DiffOperation = "added" | "removed" | "replaced";

export type DiffCategory =
  | "content"
  | "dates_state"
  | "identity"
  | "context"
  | "versions"
  | "relations"
  | "technical"
  | "other";

export type ComparisonStatus =
  | "identical"
  | "serialization_only"
  | "technical_only"
  | "review_required";

export type StructuralDifference = {
  path: string;
  operation: DiffOperation;
  beforePresent: boolean;
  afterPresent: boolean;
  before?: unknown;
  after?: unknown;
  category: DiffCategory;
};

export type SideFingerprints = {
  bodySha256: string;
  structuralSha256: string;
  watchSha256: string;
};

export type SideProvenance = {
  collectionId: string;
  collectedAtUtc: string;
  environment: string;
  collectionMetaPath: string;
  bodyPath: string;
  articleId: string;
};

export type CategoryCounters = Record<DiffCategory, number> & {
  total: number;
};

export type ComparisonReport = {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  comparisonPolicyVersion: typeof COMPARISON_POLICY_VERSION;
  comparisonId: string;
  before: SideProvenance & SideFingerprints;
  after: SideProvenance & SideFingerprints;
  status: ComparisonStatus;
  differences: StructuralDifference[];
  counters: CategoryCounters;
};

/** Chemins technical (convention du comparateur v1.0.0). */
export const TECHNICAL_PATHS = [
  "/executionTime",
  "/article/refInjection",
  "/article/idTechInjection",
] as const;

/** Racines de classement (le chemin exact et ses descendants). */
export const CATEGORY_ROOTS: ReadonlyArray<{
  category: Exclude<DiffCategory, "other" | "technical">;
  roots: readonly string[];
}> = [
  {
    category: "content",
    roots: [
      "/article/texte",
      "/article/texteHtml",
      "/article/nota",
      "/article/notaHtml",
    ],
  },
  {
    category: "dates_state",
    roots: [
      "/article/etat",
      "/article/dateDebut",
      "/article/dateFin",
      "/article/dateDebutExtension",
      "/article/dateFinExtension",
      "/article/conditionDiffere",
    ],
  },
  {
    category: "identity",
    roots: [
      "/article/id",
      "/article/cid",
      "/article/num",
      "/article/origine",
      "/article/nature",
      "/article/type",
      "/article/versionArticle",
    ],
  },
  {
    category: "context",
    roots: [
      "/article/context",
      "/article/textTitles",
      "/article/idTexte",
      "/article/cidTexte",
      "/article/sectionParentId",
      "/article/sectionParentCid",
      "/article/sectionParentTitre",
      "/article/fullSectionsTitre",
    ],
  },
  {
    category: "versions",
    roots: ["/article/articleVersions", "/article/versionPrecedente"],
  },
  {
    category: "relations",
    roots: [
      "/article/lienCitations",
      "/article/lienModifications",
      "/article/lienConcordes",
      "/article/lienAutres",
    ],
  },
];

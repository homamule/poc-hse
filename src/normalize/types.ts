/**
 * Document normalisé d'un article Légifrance (étape 2).
 * Contenu déterministe : pas d'horodatage courant ni d'UUID généré ici.
 */

export const NORMALIZER_SCHEMA_VERSION = 1 as const;
export const NORMALIZER_VERSION = "1.0.0" as const;

export type NormalizeWarning = {
  code: string;
  path: string;
  message: string;
};

/** Valeur de date principale : absente, valide (avec ISO) ou invalide. */
export type NormalizedDateField =
  | { status: "absent"; raw: null; isoUtc: null }
  | { status: "ok"; raw: number; isoUtc: string }
  | { status: "invalid"; raw: unknown; isoUtc: null };

export type NormalizedProvenance = {
  collectionId: string;
  collectedAtUtc: string;
  environment: string;
  requestedArticleId: string;
  apiUrl: string;
  bodySha256: string;
  bodyPath: string;
  collectionMetaPath: string;
};

export type NormalizedIdentity = {
  id: string | null;
  cid: string | null;
  num: string | null;
  origine: string | null;
  nature: string | null;
  type: string | null;
  versionArticle: string | null;
  etat: string | null;
};

export type NormalizedContent = {
  /** Texte brut source ; null si absent — jamais fabriqué depuis le HTML. */
  texte: string | null;
  texteHtml: string | null;
  nota: string | null;
  notaHtml: string | null;
};

export type NormalizedDates = {
  dateDebut: NormalizedDateField;
  dateFin: NormalizedDateField;
  dateDebutExtension: NormalizedDateField;
  dateFinExtension: NormalizedDateField;
};

export type NormalizedContext = {
  idTexte: unknown;
  cidTexte: unknown;
  textTitles: unknown;
  titreTxt: unknown;
  titresTM: unknown;
  sectionParentId: unknown;
  sectionParentCid: unknown;
  sectionParentTitre: unknown;
};

export type NormalizedVersions = {
  articleVersions: unknown;
  versionPrecedente: unknown;
};

export type NormalizedRelations = {
  lienCitations: unknown;
  lienModifications: unknown;
  lienConcordes: unknown;
  lienAutres: unknown;
};

export type NormalizedArticleDocument = {
  schemaVersion: typeof NORMALIZER_SCHEMA_VERSION;
  normalizerVersion: typeof NORMALIZER_VERSION;
  provenance: NormalizedProvenance;
  identity: NormalizedIdentity;
  content: NormalizedContent;
  dates: NormalizedDates;
  context: NormalizedContext;
  versions: NormalizedVersions;
  relations: NormalizedRelations;
  warnings: NormalizeWarning[];
};

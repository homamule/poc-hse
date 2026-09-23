import { normalizeMainArticleDates } from "./dates.js";
import type {
  NormalizedArticleDocument,
  NormalizedContent,
  NormalizedIdentity,
  NormalizeWarning,
} from "./types.js";
import {
  NORMALIZER_SCHEMA_VERSION,
  NORMALIZER_VERSION,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clone structurel pour détacher du JSON source sans le modifier. */
function preserve(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return structuredClone(value);
}

function asStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function extractIdentity(article: Record<string, unknown>): NormalizedIdentity {
  return {
    id: asStringOrNull(article.id),
    cid: asStringOrNull(article.cid),
    num: asStringOrNull(article.num),
    origine: asStringOrNull(article.origine),
    nature: asStringOrNull(article.nature),
    type: asStringOrNull(article.type),
    versionArticle: asStringOrNull(article.versionArticle),
    etat: asStringOrNull(article.etat),
  };
}

function extractContent(article: Record<string, unknown>): NormalizedContent {
  return {
    texte: preserveOptionalString(article, "texte"),
    texteHtml: preserveOptionalString(article, "texteHtml"),
    nota: preserveOptionalString(article, "nota"),
    notaHtml: preserveOptionalString(article, "notaHtml"),
  };
}

function preserveOptionalString(
  article: Record<string, unknown>,
  key: string,
): string | null {
  if (!(key in article)) {
    return null;
  }
  const value = article[key];
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export type BuildNormalizeInput = {
  article: Record<string, unknown>;
  provenance: NormalizedArticleDocument["provenance"];
};

/**
 * Construit le document normalisé de façon déterministe.
 * N'altère pas l'objet article source.
 */
export function buildNormalizedArticleDocument(
  input: BuildNormalizeInput,
): NormalizedArticleDocument {
  const warnings: NormalizeWarning[] = [];
  const article = input.article;

  const contextSource = isPlainObject(article.context) ? article.context : null;

  const document: NormalizedArticleDocument = {
    schemaVersion: NORMALIZER_SCHEMA_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    provenance: { ...input.provenance },
    identity: extractIdentity(article),
    content: extractContent(article),
    dates: normalizeMainArticleDates(article, warnings),
    context: {
      idTexte: preserve(article.idTexte),
      cidTexte: preserve(article.cidTexte),
      textTitles: preserve(article.textTitles),
      titreTxt: contextSource ? preserve(contextSource.titreTxt) : null,
      titresTM: contextSource ? preserve(contextSource.titresTM) : null,
      sectionParentId: preserve(article.sectionParentId),
      sectionParentCid: preserve(article.sectionParentCid),
      sectionParentTitre: preserve(article.sectionParentTitre),
    },
    versions: {
      articleVersions: preserve(article.articleVersions),
      versionPrecedente: preserve(article.versionPrecedente),
    },
    relations: {
      lienCitations: preserve(article.lienCitations),
      lienModifications: preserve(article.lienModifications),
      lienConcordes: preserve(article.lienConcordes),
      lienAutres: preserve(article.lienAutres),
    },
    warnings,
  };

  return document;
}

/** Sérialisation déterministe (ordre des clés = ordre de construction). */
export function serializeNormalizedDocument(
  document: NormalizedArticleDocument,
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

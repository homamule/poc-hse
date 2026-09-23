import { CollectError } from "../errors.js";

export const BATCH_INPUT_SCHEMA_VERSION = 1 as const;
export const BATCH_INPUT_MAX_ARTICLES = 10 as const;

export const LEGIARTI_ID_PATTERN = /^LEGIARTI\d+$/;

export type BatchInputDocument = {
  schemaVersion: typeof BATCH_INPUT_SCHEMA_VERSION;
  articleIds: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide intégralement le JSON d'entrée du lot avant tout appel réseau.
 */
export function parseBatchInput(raw: unknown): BatchInputDocument {
  if (!isPlainObject(raw)) {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      "Fichier d'entrée invalide : objet JSON attendu.",
    );
  }

  if (raw.schemaVersion !== BATCH_INPUT_SCHEMA_VERSION) {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      `schemaVersion non reconnu (attendu ${BATCH_INPUT_SCHEMA_VERSION}).`,
    );
  }

  if (!Array.isArray(raw.articleIds)) {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      "articleIds doit être un tableau.",
    );
  }

  if (raw.articleIds.length === 0) {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      "articleIds ne doit pas être vide.",
    );
  }

  if (raw.articleIds.length > BATCH_INPUT_MAX_ARTICLES) {
    throw new CollectError(
      "BATCH_INPUT_INVALID",
      `articleIds dépasse le maximum du pilote (${BATCH_INPUT_MAX_ARTICLES}).`,
    );
  }

  const articleIds: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.articleIds.length; i += 1) {
    const value = raw.articleIds[i];
    if (typeof value !== "string") {
      throw new CollectError(
        "BATCH_INPUT_INVALID",
        `articleIds[${i}] doit être une chaîne.`,
      );
    }
    if (!LEGIARTI_ID_PATTERN.test(value)) {
      throw new CollectError(
        "BATCH_INPUT_INVALID",
        `articleIds[${i}] invalide : attendu LEGIARTI suivi de chiffres uniquement.`,
      );
    }
    if (seen.has(value)) {
      throw new CollectError(
        "BATCH_INPUT_INVALID",
        `Doublon détecté dans articleIds : ${value}. Aucune déduplication silencieuse.`,
      );
    }
    seen.add(value);
    articleIds.push(value);
  }

  return {
    schemaVersion: BATCH_INPUT_SCHEMA_VERSION,
    articleIds,
  };
}

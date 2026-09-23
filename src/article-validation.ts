import { CollectError } from "./errors.js";

/**
 * Champs de contenu documentés sur le schéma Article de l'API Légifrance
 * (Swagger /consult/getArticle) :
 * - texte     : contenu textuel brut
 * - texteHtml : contenu HTML
 *
 * Règle retenue : au moins l'un des deux doit être une chaîne non vide
 * (après trim). Les deux représentations sont acceptées car le schéma les
 * expose toutes les deux ; on n'exige pas les deux simultanément.
 */
export const ARTICLE_CONTENT_FIELDS = ["texte", "texteHtml"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUsableContent(article: Record<string, unknown>): boolean {
  for (const field of ARTICLE_CONTENT_FIELDS) {
    const value = article[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Valide la structure JSON de getArticle avant toute sauvegarde de succès.
 * Ne modifie pas les données : lecture seule.
 */
export function assertValidGetArticleResponse(
  bodyJson: unknown,
  requestedArticleId: string,
): void {
  if (!isPlainObject(bodyJson)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : objet JSON attendu à la racine.",
    );
  }

  if (!("article" in bodyJson)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : propriété « article » absente.",
    );
  }

  const article = bodyJson.article;

  if (article === null) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : « article » est null.",
    );
  }

  if (Array.isArray(article)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : « article » ne doit pas être un tableau.",
    );
  }

  if (typeof article !== "object") {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : « article » doit être un objet.",
    );
  }

  if (!isPlainObject(article)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : « article » doit être un objet non nul.",
    );
  }

  if (typeof article.id !== "string" || article.id.length === 0) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : article.id doit être une chaîne non vide.",
    );
  }

  if (article.id !== requestedArticleId) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : article.id ne correspond pas à l'identifiant demandé.",
    );
  }

  if (!hasUsableContent(article)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : contenu textuel exploitable absent (champs documentés « texte » ou « texteHtml » vides ou manquants).",
    );
  }
}

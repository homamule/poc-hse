import type { AppConfig } from "./config.js";
import { CollectError } from "./errors.js";
import { mapNetworkError } from "./auth.js";

export type ArticleFetchResult = {
  url: string;
  httpStatus: number;
  /** Corps de réponse exact (octets UTF-8), sans transformation. */
  bodyText: string;
  bodyJson: unknown;
};

/**
 * Récupère un article via POST /consult/getArticle.
 * Corps documenté : { "id": "<LEGIARTI…>" }
 */
export async function fetchArticle(
  config: AppConfig,
  accessToken: string,
): Promise<ArticleFetchResult> {
  const url = config.getArticleUrl;
  const requestBody = JSON.stringify({ id: config.articleId });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw mapNetworkError(error, "collecte d'article");
  }

  const bodyText = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new CollectError(
      "AUTH",
      `Accès refusé à l'API Légifrance (HTTP ${response.status}). Jeton invalide/expiré, ou application non autorisée sur l'API.`,
    );
  }

  if (response.status === 429) {
    throw new CollectError(
      "QUOTA",
      `Quota API Légifrance dépassé (HTTP 429). Réessayez plus tard.`,
    );
  }

  if (response.status === 404) {
    throw new CollectError(
      "NOT_FOUND",
      `Article introuvable (HTTP 404) pour l'identifiant demandé : ${config.articleId}`,
    );
  }

  if (!response.ok) {
    throw new CollectError(
      "HTTP",
      `Réponse HTTP inattendue de l'API Légifrance (HTTP ${response.status}).`,
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText) as unknown;
  } catch {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : JSON attendu.",
    );
  }

  if (!isObject(bodyJson) || !("article" in bodyJson) || bodyJson.article == null) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse API invalide : propriété « article » absente. La collecte est considérée comme échouée.",
    );
  }

  return {
    url,
    httpStatus: response.status,
    bodyText,
    bodyJson,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

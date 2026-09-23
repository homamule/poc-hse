/**
 * Extraction prudente de champs utiles pour le résumé console.
 * N'invente aucune valeur : n'affiche que ce qui est présent dans la réponse.
 */

export type ArticleSummary = {
  id: string | null;
  num: string | null;
  versionInfo: Record<string, string | number | boolean | null>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDisplayScalar(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

const VERSION_KEYS = [
  "versionArticle",
  "etat",
  "dateDebut",
  "dateFin",
  "dateDebutExtension",
  "dateFinExtension",
  "numeroVersion",
  "ordre",
] as const;

export function extractArticleSummary(bodyJson: unknown): ArticleSummary {
  if (!isObject(bodyJson) || !isObject(bodyJson.article)) {
    return { id: null, num: null, versionInfo: {} };
  }

  const article = bodyJson.article;
  const id = typeof article.id === "string" ? article.id : null;
  const num = typeof article.num === "string" ? article.num : null;

  const versionInfo: Record<string, string | number | boolean | null> = {};
  for (const key of VERSION_KEYS) {
    if (!(key in article)) continue;
    const scalar = asDisplayScalar(article[key]);
    if (scalar !== undefined) {
      versionInfo[key] = scalar;
    }
  }

  return { id, num, versionInfo };
}

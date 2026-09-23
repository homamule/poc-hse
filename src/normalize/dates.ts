import type { NormalizedDateField, NormalizeWarning } from "./types.js";

const DATE_FIELD_NAMES = [
  "dateDebut",
  "dateFin",
  "dateDebutExtension",
  "dateFinExtension",
] as const;

export type ArticleDateFieldName = (typeof DATE_FIELD_NAMES)[number];

/**
 * Convertit une date principale d'article.
 * Seuls les nombres de millisecondes finis sont convertis en ISO UTC.
 * Les dates des structures imbriquées ne passent pas par cette fonction.
 */
export function normalizeArticleDate(
  raw: unknown,
  fieldPath: string,
  warnings: NormalizeWarning[],
): NormalizedDateField {
  if (raw === undefined || raw === null) {
    return { status: "absent", raw: null, isoUtc: null };
  }

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    warnings.push({
      code: "DATE_INVALID",
      path: fieldPath,
      message: `Valeur de date invalide (type non numérique ou non fini) ; aucune ISO inventée.`,
    });
    return { status: "invalid", raw, isoUtc: null };
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    warnings.push({
      code: "DATE_INVALID",
      path: fieldPath,
      message: `Valeur numérique non convertible en date UTC ; aucune ISO inventée.`,
    });
    return { status: "invalid", raw, isoUtc: null };
  }

  const isoUtc = date.toISOString();

  if (isoUtc.startsWith("2999-01-01")) {
    warnings.push({
      code: "DATE_SENTINEL_2999",
      path: fieldPath,
      message:
        "La date ISO 2999-01-01 est conservée telle quelle ; sa signification métier reste à confirmer.",
    });
  }

  return { status: "ok", raw, isoUtc };
}

export function normalizeMainArticleDates(
  article: Record<string, unknown>,
  warnings: NormalizeWarning[],
): Record<ArticleDateFieldName, NormalizedDateField> {
  const result = {} as Record<ArticleDateFieldName, NormalizedDateField>;
  for (const name of DATE_FIELD_NAMES) {
    result[name] = normalizeArticleDate(
      article[name],
      `dates.${name}`,
      warnings,
    );
  }
  return result;
}

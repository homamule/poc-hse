import { config as loadDotenv } from "dotenv";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  GET_ARTICLE_PATH,
  PISTE_URLS,
  type PisteEnv,
} from "./piste.js";
import { CollectError } from "./errors.js";

/** Configuration OAuth / PISTE commune (sans identifiant d'article). */
export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  env: PisteEnv;
  timeoutMs: number;
  oauthTokenUrl: string;
  getArticleUrl: string;
};

export type AppConfig = OAuthConfig & {
  articleId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CollectError(
      "CONFIG",
      `Variable d'environnement manquante ou vide : ${name}. Copiez .env.example vers .env et renseignez les valeurs.`,
    );
  }
  return value;
}

function parseEnv(raw: string): PisteEnv {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "sandbox" || normalized === "production") {
    return normalized;
  }
  throw new CollectError(
    "CONFIG",
    `PISTE_ENV invalide : "${raw}". Valeurs acceptées : sandbox, production.`,
  );
}

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CollectError(
      "CONFIG",
      `REQUEST_TIMEOUT_MS invalide : "${raw}". Attendu : entier positif en millisecondes.`,
    );
  }
  return value;
}

/**
 * Charge la configuration OAuth PISTE depuis `.env`.
 * N'exige pas LEGIFRANCE_ARTICLE_ID (réservé à `npm run collect`).
 */
export function loadOAuthConfig(): OAuthConfig {
  loadDotenv();

  const env = parseEnv(requireEnv("PISTE_ENV"));
  const urls = PISTE_URLS[env];

  return {
    clientId: requireEnv("PISTE_CLIENT_ID"),
    clientSecret: requireEnv("PISTE_CLIENT_SECRET"),
    env,
    timeoutMs: parseTimeoutMs(process.env.REQUEST_TIMEOUT_MS),
    oauthTokenUrl: urls.oauthToken,
    getArticleUrl: `${urls.apiBase}${GET_ARTICLE_PATH}`,
  };
}

/** Configuration complète pour la collecte unitaire (`npm run collect`). */
export function loadConfig(): AppConfig {
  const oauth = loadOAuthConfig();
  return {
    ...oauth,
    articleId: requireEnv("LEGIFRANCE_ARTICLE_ID"),
  };
}

export function configForArticle(
  oauth: OAuthConfig,
  articleId: string,
): AppConfig {
  return { ...oauth, articleId };
}

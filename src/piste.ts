/**
 * URLs et chemins issus de la documentation officielle PISTE / Légifrance
 * (FAQ API Légifrance, guide PISTE, catalogue API).
 * Ne pas modifier sans vérifier la documentation à jour.
 */

export type PisteEnv = "sandbox" | "production";

export const PISTE_URLS = {
  sandbox: {
    oauthToken: "https://sandbox-oauth.piste.gouv.fr/api/oauth/token",
    apiBase: "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app",
  },
  production: {
    oauthToken: "https://oauth.piste.gouv.fr/api/oauth/token",
    apiBase: "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app",
  },
} as const;

/** Endpoint documenté : POST /consult/getArticle */
export const GET_ARTICLE_PATH = "/consult/getArticle";

export const OAUTH_SCOPE = "openid";
export const OAUTH_GRANT_TYPE = "client_credentials";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

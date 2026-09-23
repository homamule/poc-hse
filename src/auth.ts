import type { OAuthConfig } from "./config.js";
import { CollectError } from "./errors.js";
import { mapNetworkError, readResponseText } from "./http.js";
import { OAUTH_GRANT_TYPE, OAUTH_SCOPE } from "./piste.js";

/** Codes OAuth2 « error » standards (RFC 6749) que nous exposons au diagnostic. */
export const KNOWN_OAUTH_ERROR_CODES = [
  "invalid_client",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type",
] as const;

export type KnownOAuthErrorCode = (typeof KNOWN_OAUTH_ERROR_CODES)[number];

const KNOWN_OAUTH_ERROR_SET: ReadonlySet<string> = new Set(KNOWN_OAUTH_ERROR_CODES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extrait uniquement le champ standard « error » s'il correspond à un code connu.
 * Ne lit ni n'expose error_description, ni aucun autre champ du corps.
 */
export function extractKnownOAuthErrorCode(rawText: string): KnownOAuthErrorCode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  const error = parsed.error;
  if (typeof error !== "string" || !KNOWN_OAUTH_ERROR_SET.has(error)) {
    return null;
  }
  return error as KnownOAuthErrorCode;
}

function oauthAuthError(httpStatus: number, rawText: string): CollectError {
  const oauthError = extractKnownOAuthErrorCode(rawText);
  if (oauthError !== null) {
    return new CollectError(
      "AUTH",
      `Échec d'authentification OAuth2 (HTTP ${httpStatus}, error=${oauthError}).`,
    );
  }
  return new CollectError(
    "AUTH",
    `Échec d'authentification OAuth2 (HTTP ${httpStatus}).`,
  );
}

/**
 * Obtient un jeton OAuth2 via le flux client_credentials (PISTE).
 *
 * Paramètres conformes à la documentation officielle PISTE / FAQ Légifrance :
 * POST application/x-www-form-urlencoded avec grant_type=client_credentials,
 * client_id, client_secret et scope=openid (dans le corps, pas en Basic Auth).
 *
 * Le jeton n'est jamais journalisé. Aucun message n'expose le secret, le jeton,
 * le corps complet ni error_description.
 */
export async function fetchAccessToken(config: OAuthConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: OAUTH_GRANT_TYPE,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: OAUTH_SCOPE,
  });

  let response: Response;
  try {
    response = await fetch(config.oauthTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw mapNetworkError(error, "authentification OAuth2");
  }

  const rawText = await readResponseText(response, "authentification OAuth2");

  if (response.status === 429) {
    throw new CollectError(
      "QUOTA",
      `Quota OAuth2 dépassé (HTTP 429) lors de l'obtention du jeton.`,
    );
  }

  if (!response.ok) {
    throw oauthAuthError(response.status, rawText);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse OAuth2 invalide : JSON attendu.",
    );
  }

  if (!isPlainObject(parsed)) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse OAuth2 invalide : objet JSON attendu.",
    );
  }

  const accessToken = parsed.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse OAuth2 invalide : access_token manquant.",
    );
  }

  return accessToken;
}

export { mapNetworkError };

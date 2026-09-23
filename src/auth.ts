import type { AppConfig } from "./config.js";
import { CollectError } from "./errors.js";
import { mapNetworkError, readResponseText } from "./http.js";
import { OAUTH_GRANT_TYPE, OAUTH_SCOPE } from "./piste.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Obtient un jeton OAuth2 via le flux client_credentials (PISTE).
 * Le jeton n'est jamais journalisé ni renvoyé hors de cette couche.
 * Aucun message d'erreur n'expose le secret, le jeton ou le corps OAuth.
 */
export async function fetchAccessToken(config: AppConfig): Promise<string> {
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

  if (response.status === 401 || response.status === 403) {
    throw new CollectError(
      "AUTH",
      `Échec d'authentification OAuth2 (HTTP ${response.status}). Vérifiez PISTE_CLIENT_ID, PISTE_CLIENT_SECRET et PISTE_ENV.`,
    );
  }

  if (response.status === 429) {
    throw new CollectError(
      "QUOTA",
      `Quota OAuth2 dépassé (HTTP 429) lors de l'obtention du jeton.`,
    );
  }

  if (!response.ok) {
    throw new CollectError(
      "AUTH",
      `Réponse OAuth2 inattendue (HTTP ${response.status}).`,
    );
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

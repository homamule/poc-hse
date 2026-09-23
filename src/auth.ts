import type { AppConfig } from "./config.js";
import { CollectError } from "./errors.js";
import { OAUTH_GRANT_TYPE, OAUTH_SCOPE } from "./piste.js";

type TokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

/**
 * Obtient un jeton OAuth2 via le flux client_credentials (PISTE).
 * Le jeton n'est jamais journalisé ni renvoyé hors de cette couche.
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

  const rawText = await response.text();

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

  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(rawText) as TokenResponse;
  } catch {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse OAuth2 invalide : JSON attendu.",
    );
  }

  if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
    throw new CollectError(
      "INVALID_RESPONSE",
      "Réponse OAuth2 invalide : access_token manquant.",
    );
  }

  return parsed.access_token;
}

function mapNetworkError(error: unknown, context: string): CollectError {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new CollectError(
      "NETWORK",
      `Délai maximal dépassé lors de la requête ${context}.`,
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new CollectError(
      "NETWORK",
      `Requête ${context} annulée (délai maximal ou interruption).`,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new CollectError(
    "NETWORK",
    `Erreur réseau lors de la requête ${context} : ${detail}`,
  );
}

export { mapNetworkError };

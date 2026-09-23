import { CollectError } from "./errors.js";

/**
 * Convertit une erreur de transport / lecture en CollectError NETWORK.
 * N'inclut jamais de secret, jeton ou corps de réponse.
 */
export function mapNetworkError(error: unknown, context: string): CollectError {
  if (error instanceof CollectError) {
    return error;
  }
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
  return new CollectError(
    "NETWORK",
    `Erreur réseau lors de la requête ${context} (échec de transport ou de lecture du corps).`,
  );
}

/**
 * Lit le corps HTTP ; toute interruption est classée NETWORK.
 */
export async function readResponseText(
  response: Response,
  context: string,
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw mapNetworkError(error, context);
  }
}

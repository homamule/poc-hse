import type { AppConfig } from "../src/config.js";

/** Identifiant synthétique réservé aux tests (pas un appel PISTE). */
export const TEST_ARTICLE_ID = "LEGIARTI000000000001";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    env: "sandbox",
    articleId: TEST_ARTICLE_ID,
    timeoutMs: 5_000,
    oauthTokenUrl: "https://oauth.test/token",
    getArticleUrl: "https://api.test/consult/getArticle",
    ...overrides,
  };
}

export function validArticleBody(
  overrides: Record<string, unknown> = {},
): string {
  const article = {
    id: TEST_ARTICLE_ID,
    num: "1",
    texte: "Contenu textuel de test.",
    etat: "VIGUEUR",
    versionArticle: "1.0",
    ...overrides,
  };
  return JSON.stringify({ article });
}

export function mockJsonResponse(
  status: number,
  body: unknown,
  init: { ok?: boolean } = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    status,
    ok,
    text: async () => text,
  } as Response;
}

export function mockTextFailResponse(
  status: number,
  error: Error,
): Response {
  const ok = status >= 200 && status < 300;
  return {
    status,
    ok,
    text: async () => {
      throw error;
    },
  } as Response;
}

export async function withMockFetch<T>(
  impl: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

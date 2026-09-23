import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractKnownOAuthErrorCode,
  fetchAccessToken,
  KNOWN_OAUTH_ERROR_CODES,
} from "../src/auth.js";
import { isCollectError } from "../src/errors.js";
import {
  mockJsonResponse,
  mockTextFailResponse,
  testConfig,
  withMockFetch,
} from "./helpers.js";

describe("extractKnownOAuthErrorCode", () => {
  it("extrait les codes OAuth connus", () => {
    for (const code of KNOWN_OAUTH_ERROR_CODES) {
      assert.equal(
        extractKnownOAuthErrorCode(JSON.stringify({ error: code })),
        code,
      );
    }
  });

  it("ignore error_description et les codes inconnus", () => {
    assert.equal(
      extractKnownOAuthErrorCode(
        JSON.stringify({
          error: "access_denied",
          error_description: "secret leak should never appear",
        }),
      ),
      null,
    );
    assert.equal(extractKnownOAuthErrorCode("{not-json"), null);
    assert.equal(extractKnownOAuthErrorCode("null"), null);
  });
});

describe("fetchAccessToken", () => {
  it("retourne le jeton pour une réponse OAuth valide", async () => {
    const token = await withMockFetch(
      async () =>
        mockJsonResponse(200, {
          access_token: "opaque-token-value",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      () => fetchAccessToken(testConfig()),
    );
    assert.equal(token, "opaque-token-value");
  });

  it("rejette JSON null", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(200, "null"),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) =>
        isCollectError(error) && error.code === "INVALID_RESPONSE",
    );
  });

  it("rejette objet sans access_token", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(200, { token_type: "Bearer" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) =>
        isCollectError(error) && error.code === "INVALID_RESPONSE",
    );
  });

  it("diagnostique HTTP 400 avec error=invalid_client sans exposer error_description", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () =>
            mockJsonResponse(400, {
              error: "invalid_client",
              error_description: "Client authentication failed: secret=s3cret",
            }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => {
        if (!isCollectError(error) || error.code !== "AUTH") return false;
        assert.match(error.message, /HTTP 400/);
        assert.match(error.message, /error=invalid_client/);
        assert.doesNotMatch(error.message, /error_description/);
        assert.doesNotMatch(error.message, /s3cret/);
        assert.doesNotMatch(error.message, /test-client-secret/);
        return true;
      },
    );
  });

  it("diagnostique chaque code OAuth connu sur HTTP 400", async () => {
    for (const code of KNOWN_OAUTH_ERROR_CODES) {
      await assert.rejects(
        () =>
          withMockFetch(
            async () =>
              mockJsonResponse(400, {
                error: code,
                error_description: "ne doit pas apparaître",
              }),
            () => fetchAccessToken(testConfig()),
          ),
        (error: unknown) => {
          if (!isCollectError(error) || error.code !== "AUTH") return false;
          assert.match(error.message, new RegExp(`error=${code}`));
          assert.doesNotMatch(error.message, /ne doit pas apparaître/);
          return true;
        },
      );
    }
  });

  it("conserve un message générique si error OAuth absent ou inconnu", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () =>
            mockJsonResponse(400, {
              error: "access_denied",
              error_description: "détail sensible",
            }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => {
        if (!isCollectError(error) || error.code !== "AUTH") return false;
        assert.equal(
          error.message,
          "Échec d'authentification OAuth2 (HTTP 400).",
        );
        assert.doesNotMatch(error.message, /access_denied/);
        assert.doesNotMatch(error.message, /détail sensible/);
        return true;
      },
    );
  });

  it("classe 401 en AUTH avec code connu si présent", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(401, { error: "invalid_client" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) =>
        isCollectError(error) &&
        error.code === "AUTH" &&
        /HTTP 401/.test(error.message) &&
        /error=invalid_client/.test(error.message),
    );
  });

  it("classe 403 en AUTH (message générique si code non listé)", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(403, { error: "access_denied" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) =>
        isCollectError(error) &&
        error.code === "AUTH" &&
        error.message === "Échec d'authentification OAuth2 (HTTP 403).",
    );
  });

  it("classe 429 en QUOTA", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(429, { error: "rate_limit" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => isCollectError(error) && error.code === "QUOTA",
    );
  });

  it("classe l'échec de fetch en NETWORK", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => {
            throw new TypeError("fetch failed");
          },
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => {
        if (!isCollectError(error) || error.code !== "NETWORK") return false;
        assert.doesNotMatch(error.message, /test-client-secret/);
        assert.doesNotMatch(error.message, /opaque-token/);
        return true;
      },
    );
  });

  it("classe l'interruption de response.text() en NETWORK", async () => {
    const abortError = new Error("body interrupted");
    abortError.name = "AbortError";
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockTextFailResponse(200, abortError),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => {
        if (!isCollectError(error) || error.code !== "NETWORK") return false;
        assert.doesNotMatch(error.message, /test-client-secret/);
        assert.doesNotMatch(error.message, /access_token/);
        return true;
      },
    );
  });
});

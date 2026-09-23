import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchAccessToken } from "../src/auth.js";
import { isCollectError } from "../src/errors.js";
import {
  mockJsonResponse,
  mockTextFailResponse,
  testConfig,
  withMockFetch,
} from "./helpers.js";

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

  it("classe 401 en AUTH", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(401, { error: "invalid_client" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => isCollectError(error) && error.code === "AUTH",
    );
  });

  it("classe 403 en AUTH", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(403, { error: "access_denied" }),
          () => fetchAccessToken(testConfig()),
        ),
      (error: unknown) => isCollectError(error) && error.code === "AUTH",
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

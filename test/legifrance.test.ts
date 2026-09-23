import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchArticle } from "../src/legifrance.js";
import { saveSuccessfulCollection } from "../src/storage.js";
import { isCollectError } from "../src/errors.js";
import {
  mockJsonResponse,
  mockTextFailResponse,
  TEST_ARTICLE_ID,
  testConfig,
  validArticleBody,
  withMockFetch,
} from "./helpers.js";

describe("fetchArticle", () => {
  it("accepte une réponse d'article valide et conserve le corps brut", async () => {
    const raw = validArticleBody();
    const result = await withMockFetch(
      async () => mockJsonResponse(200, raw),
      () => fetchArticle(testConfig(), "test-token"),
    );
    assert.equal(result.httpStatus, 200);
    assert.equal(result.bodyText, raw);
    assert.deepEqual(result.bodyJson, JSON.parse(raw));
  });

  it("rejette JSON invalide", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(200, "{not-json"),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) =>
        isCollectError(error) && error.code === "INVALID_RESPONSE",
    );
  });

  it("rejette article vide", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(200, { article: {} }),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) =>
        isCollectError(error) && error.code === "INVALID_RESPONSE",
    );
  });

  it("classe 401 en AUTH", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(401, { message: "unauthorized" }),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) => isCollectError(error) && error.code === "AUTH",
    );
  });

  it("classe 403 en AUTH", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(403, { message: "forbidden" }),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) => isCollectError(error) && error.code === "AUTH",
    );
  });

  it("classe 404 en NOT_FOUND", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(404, { message: "not found" }),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) => isCollectError(error) && error.code === "NOT_FOUND",
    );
  });

  it("classe 429 en QUOTA", async () => {
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockJsonResponse(429, { message: "quota" }),
          () => fetchArticle(testConfig(), "test-token"),
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
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) => isCollectError(error) && error.code === "NETWORK",
    );
  });

  it("classe l'interruption de response.text() en NETWORK", async () => {
    const abortError = new Error("body interrupted");
    abortError.name = "AbortError";
    await assert.rejects(
      () =>
        withMockFetch(
          async () => mockTextFailResponse(200, abortError),
          () => fetchArticle(testConfig(), "test-token"),
        ),
      (error: unknown) => isCollectError(error) && error.code === "NETWORK",
    );
  });

  it("une collecte rejetée ne déclenche aucune sauvegarde de succès", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graphrag-hse-"));
    let saved = false;

    try {
      const article = await withMockFetch(
        async () => mockJsonResponse(200, { article: "invalid" }),
        () => fetchArticle(testConfig(), "test-token"),
      );
      await saveSuccessfulCollection({
        bodyText: article.bodyText,
        environment: "sandbox",
        requestedArticleId: TEST_ARTICLE_ID,
        url: testConfig().getArticleUrl,
        httpStatus: article.httpStatus,
        dataDir,
      });
      saved = true;
    } catch (error) {
      assert.ok(isCollectError(error));
      assert.equal(error.code, "INVALID_RESPONSE");
    }

    assert.equal(saved, false);
    const entries = await readdir(dataDir);
    assert.deepEqual(entries, []);
  });
});

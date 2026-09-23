import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertValidGetArticleResponse } from "../src/article-validation.js";
import { isCollectError } from "../src/errors.js";
import { TEST_ARTICLE_ID } from "./helpers.js";

function expectInvalid(body: unknown, requestedId = TEST_ARTICLE_ID): void {
  assert.throws(
    () => assertValidGetArticleResponse(body, requestedId),
    (error: unknown) =>
      isCollectError(error) && error.code === "INVALID_RESPONSE",
  );
}

describe("assertValidGetArticleResponse", () => {
  it("accepte un article valide avec texte", () => {
    assert.doesNotThrow(() =>
      assertValidGetArticleResponse(
        {
          article: {
            id: TEST_ARTICLE_ID,
            texte: "Contenu.",
          },
        },
        TEST_ARTICLE_ID,
      ),
    );
  });

  it("accepte un article valide avec texteHtml seulement", () => {
    assert.doesNotThrow(() =>
      assertValidGetArticleResponse(
        {
          article: {
            id: TEST_ARTICLE_ID,
            texteHtml: "<p>Contenu</p>",
          },
        },
        TEST_ARTICLE_ID,
      ),
    );
  });

  it("rejette article absent", () => {
    expectInvalid({});
  });

  it("rejette article null", () => {
    expectInvalid({ article: null });
  });

  it("rejette article objet vide", () => {
    expectInvalid({ article: {} });
  });

  it("rejette article tableau", () => {
    expectInvalid({ article: [] });
  });

  it("rejette article chaîne", () => {
    expectInvalid({ article: "invalid" });
  });

  it("rejette identifiant différent", () => {
    expectInvalid({
      article: {
        id: "LEGIARTI000000000999",
        texte: "Contenu.",
      },
    });
  });

  it("rejette contenu absent", () => {
    expectInvalid({
      article: {
        id: TEST_ARTICLE_ID,
        num: "1",
      },
    });
  });

  it("rejette contenu vide (espaces)", () => {
    expectInvalid({
      article: {
        id: TEST_ARTICLE_ID,
        texte: "   ",
        texteHtml: "",
      },
    });
  });
});

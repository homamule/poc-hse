import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveSuccessfulCollection,
  sha256Hex,
} from "../src/storage.js";
import { isCollectError } from "../src/errors.js";
import { TEST_ARTICLE_ID, validArticleBody } from "./helpers.js";

describe("saveSuccessfulCollection", () => {
  it("deux sauvegardes identiques au même horodatage : un corps, deux métadonnées", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graphrag-hse-"));
    const bodyText = validArticleBody();
    const stamp = "2026-09-23T10:00:00.000Z";
    const common = {
      bodyText,
      environment: "sandbox" as const,
      requestedArticleId: TEST_ARTICLE_ID,
      url: "https://api.test/consult/getArticle",
      httpStatus: 200,
      collectedAtUtc: stamp,
      dataDir,
    };

    const first = await saveSuccessfulCollection({
      ...common,
      collectionId: "11111111-1111-1111-1111-111111111111",
    });
    const second = await saveSuccessfulCollection({
      ...common,
      collectionId: "22222222-2222-2222-2222-222222222222",
    });

    assert.equal(first.sha256, second.sha256);
    assert.equal(first.sha256, sha256Hex(bodyText));
    assert.equal(first.bodyAlreadyExisted, false);
    assert.equal(second.bodyAlreadyExisted, true);
    assert.notEqual(first.collectionMetaPath, second.collectionMetaPath);
    assert.equal(first.metadata.collectionId, "11111111-1111-1111-1111-111111111111");
    assert.equal(second.metadata.collectionId, "22222222-2222-2222-2222-222222222222");

    const bodies = await readdir(path.join(dataDir, "bodies"));
    const collections = await readdir(path.join(dataDir, "collections"));
    assert.equal(bodies.length, 1);
    assert.equal(collections.length, 2);

    const storedBody = await readFile(
      path.join(dataDir, "bodies", bodies[0]!),
      "utf8",
    );
    assert.equal(storedBody, bodyText);

    const meta1 = JSON.parse(
      await readFile(first.collectionMetaPath, "utf8"),
    ) as { collectionId: string; bodySha256: string };
    const meta2 = JSON.parse(
      await readFile(second.collectionMetaPath, "utf8"),
    ) as { collectionId: string; bodySha256: string };
    assert.equal(meta1.bodySha256, meta2.bodySha256);
    assert.notEqual(meta1.collectionId, meta2.collectionId);
  });

  it("refuse d'écraser un fichier de métadonnées existant (flag wx)", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "graphrag-hse-"));
    const bodyText = validArticleBody();
    const input = {
      bodyText,
      environment: "sandbox" as const,
      requestedArticleId: TEST_ARTICLE_ID,
      url: "https://api.test/consult/getArticle",
      httpStatus: 200,
      collectedAtUtc: "2026-09-23T10:00:00.000Z",
      collectionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      dataDir,
    };

    await saveSuccessfulCollection(input);
    await assert.rejects(
      () => saveSuccessfulCollection(input),
      (error: unknown) => isCollectError(error) && error.code === "STORAGE",
    );

    const collections = await readdir(path.join(dataDir, "collections"));
    assert.equal(collections.length, 1);
  });
});

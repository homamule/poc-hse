import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  classifyPath,
  structuralSha256,
  watchSha256,
} from "../src/compare/canonicalize.js";
import { diffJson } from "../src/compare/diff.js";
import { escapePointerSegment, pathMatchesRoot } from "../src/compare/pointer.js";
import { isCompareError } from "../src/compare/errors.js";
import { runCompare } from "../src/compare/run.js";

const ARTICLE_ID = "LEGIARTI000035640828";

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function baseArticle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ARTICLE_ID,
    cid: "LEGIARTI000006903147",
    num: "L4121-1",
    texte: "Texte A",
    texteHtml: "<p>Texte A</p>",
    nota: null,
    notaHtml: null,
    etat: "VIGUEUR",
    dateDebut: 1506816000000,
    dateFin: 32472144000000,
    dateDebutExtension: 32472144000000,
    dateFinExtension: 32472144000000,
    refInjection: "MD-AAA",
    idTechInjection: null,
    idTexte: null,
    cidTexte: null,
    textTitles: [{ id: "LEGITEXT1", titre: "Code" }],
    context: { titreTxt: [{ id: "T1" }], titresTM: [] },
    articleVersions: [{ id: ARTICLE_ID, version: "3.0" }],
    versionPrecedente: "LEGIARTI000023032086",
    lienCitations: [{ articleId: "X", linkOrientation: "cible" }],
    lienModifications: [],
    lienConcordes: [],
    lienAutres: [],
    ...overrides,
  };
}

function bodyOf(article: Record<string, unknown>, executionTime = 1): string {
  return `${JSON.stringify({ executionTime, article })}\n`;
}

async function writeCollection(input: {
  projectRoot: string;
  collectionId: string;
  collectedAtUtc: string;
  bodyText: string;
  environment?: string;
  requestedArticleId?: string;
}): Promise<string> {
  const bodiesDir = path.join(input.projectRoot, "data", "bodies");
  const collectionsDir = path.join(input.projectRoot, "data", "collections");
  await mkdir(bodiesDir, { recursive: true });
  await mkdir(collectionsDir, { recursive: true });

  const sha = sha256Utf8(input.bodyText);
  const bodyRel = `data/bodies/${sha}.json`;
  await writeFile(path.join(input.projectRoot, bodyRel), input.bodyText, "utf8");

  const articleId = input.requestedArticleId ?? ARTICLE_ID;
  const metaRel = `data/collections/${input.collectedAtUtc.replace(/[:.]/g, "-")}_${articleId}_${input.collectionId}.json`;
  const metadata = {
    collectedAtUtc: input.collectedAtUtc,
    collectionId: input.collectionId,
    environment: input.environment ?? "sandbox",
    requestedArticleId: articleId,
    url: "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/getArticle",
    httpStatus: 200,
    bodySha256: sha,
    bodyPath: bodyRel,
    bodyAlreadyExisted: false,
    collectionMetaPath: metaRel,
  };
  await writeFile(
    path.join(input.projectRoot, metaRel),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  return metaRel;
}

describe("pointer / classification", () => {
  it("échappe / et ~ et Matche les racines par segments", () => {
    assert.equal(escapePointerSegment("a/b"), "a~1b");
    assert.equal(escapePointerSegment("a~b"), "a~0b");
    assert.equal(pathMatchesRoot("/article/texte", "/article/texte"), true);
    assert.equal(pathMatchesRoot("/article/texteHtml", "/article/texte"), false);
    assert.equal(pathMatchesRoot("/article/context/x", "/article/context"), true);
    assert.equal(classifyPath("/article/refInjection"), "technical");
    assert.equal(classifyPath("/article/texte"), "content");
    assert.equal(classifyPath("/article/nouveauChamp"), "other");
  });
});

describe("canonicalize / fingerprints", () => {
  it("ignore l'ordre des clés et gère __proto__", () => {
    const a = JSON.parse('{"b":1,"a":2,"__proto__":3}') as unknown;
    const b = JSON.parse('{"__proto__":3,"a":2,"b":1}') as unknown;
    assert.equal(structuralSha256(a), structuralSha256(b));
    const canon = canonicalize(a) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(canon), null);
    assert.equal(canon.__proto__, 3);
  });

  it("watchSha256 ignore uniquement les chemins technical", () => {
    const base = {
      executionTime: 1,
      article: baseArticle({ refInjection: "A", idTechInjection: "T1" }),
    };
    const changed = {
      executionTime: 99,
      article: baseArticle({ refInjection: "B", idTechInjection: "T2" }),
    };
    assert.notEqual(structuralSha256(base), structuralSha256(changed));
    assert.equal(watchSha256(base), watchSha256(changed));

    const withUnknown = {
      executionTime: 1,
      article: baseArticle({ refInjection: "A", nouveau: true }),
    };
    assert.notEqual(watchSha256(base), watchSha256(withUnknown));
  });
});

describe("diffJson", () => {
  it("distingue absent, null et chaîne vide ; tableaux réordonnés", () => {
    const d1 = diffJson({ a: null }, { a: "" });
    assert.equal(d1.length, 1);
    assert.equal(d1[0]?.operation, "replaced");

    const left: Record<string, unknown> = {};
    const right = { a: null };
    const dAbsent = diffJson(left, right);
    assert.equal(dAbsent[0]?.operation, "added");
    assert.equal(dAbsent[0]?.beforePresent, false);

    const emptyVsAbsent = diffJson({ a: "" }, {});
    assert.equal(emptyVsAbsent[0]?.operation, "removed");

    const arr = diffJson({ t: [1, 2] }, { t: [2, 1] });
    assert.equal(arr.length, 1);
    assert.equal(arr[0]?.path, "/t");
    assert.deepEqual(arr[0]?.before, [1, 2]);
  });
});

describe("runCompare", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  async function freshRoot(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "graphrag-cmp-"));
    cleanups.push(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });
    return projectRoot;
  }

  it("corps identiques -> identical", async () => {
    const projectRoot = await freshRoot();
    const body = bodyOf(baseArticle());
    const before = await writeCollection({
      projectRoot,
      collectionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: body,
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: body,
    });

    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "identical");
    assert.equal(outcome.report.counters.total, 0);
    assert.equal(
      outcome.report.before.bodySha256,
      outcome.report.after.bodySha256,
    );
  });

  it("refInjection seul -> technical_only, watch identiques", async () => {
    const projectRoot = await freshRoot();
    const beforeBody = bodyOf(baseArticle({ refInjection: "MD-20260722_201045_171_BDJQUOT" }));
    const afterBody = bodyOf(baseArticle({ refInjection: "MD-20260722_201041_133_BDJQUOT" }));
    const before = await writeCollection({
      projectRoot,
      collectionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: beforeBody,
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: afterBody,
    });

    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "technical_only");
    assert.notEqual(
      outcome.report.before.bodySha256,
      outcome.report.after.bodySha256,
    );
    assert.notEqual(
      outcome.report.before.structuralSha256,
      outcome.report.after.structuralSha256,
    );
    assert.equal(
      outcome.report.before.watchSha256,
      outcome.report.after.watchSha256,
    );
    assert.equal(outcome.report.differences.length, 1);
    assert.equal(outcome.report.differences[0]?.path, "/article/refInjection");
    assert.equal(outcome.report.differences[0]?.category, "technical");
  });

  it("executionTime seul -> technical_only", async () => {
    const projectRoot = await freshRoot();
    const article = baseArticle();
    const before = await writeCollection({
      projectRoot,
      collectionId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(article, 1),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(article, 42),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "technical_only");
    assert.equal(outcome.report.differences[0]?.path, "/executionTime");
  });

  it("texte modifié -> review_required content", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111101",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ texte: "A" })),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111102",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ texte: "B" })),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.equal(outcome.report.counters.content, 1);
  });

  it("HTML modifié avec texte brut identique -> review_required", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111103",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ texteHtml: "<p>A</p>" })),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111104",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ texteHtml: "<p>B</p>" })),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.ok(
      outcome.report.differences.some((d) => d.path === "/article/texteHtml"),
    );
  });

  it("date ou état modifié -> dates_state", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111105",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ etat: "VIGUEUR" })),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111106",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ etat: "MODIFIE" })),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.equal(outcome.report.counters.dates_state, 1);
  });

  it("relation modifiée -> relations", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111107",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(
        baseArticle({
          lienCitations: [{ articleId: "X", linkOrientation: "cible" }],
        }),
      ),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111108",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(
        baseArticle({
          lienCitations: [{ articleId: "Y", linkOrientation: "source" }],
        }),
      ),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.equal(outcome.report.counters.relations, 1);
  });

  it("technique + contenu combinés -> review_required", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111109",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ refInjection: "A", texte: "1" })),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111110",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ refInjection: "B", texte: "2" })),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.ok(outcome.report.counters.technical >= 1);
    assert.ok(outcome.report.counters.content >= 1);
  });

  it("champ inconnu -> other et review_required", async () => {
    const projectRoot = await freshRoot();
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111111",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: bodyOf(baseArticle()),
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111112",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ champInconnu: "x" })),
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "review_required");
    assert.equal(outcome.report.counters.other, 1);
    assert.equal(outcome.report.differences[0]?.category, "other");
  });

  it("ordre des clés différent -> serialization_only", async () => {
    const projectRoot = await freshRoot();
    const article = baseArticle();
    const beforeText = `${JSON.stringify({ executionTime: 1, article })}\n`;
    const afterText = `${JSON.stringify({ article, executionTime: 1 })}\n`;
    assert.notEqual(beforeText, afterText);
    assert.equal(
      structuralSha256(JSON.parse(beforeText)),
      structuralSha256(JSON.parse(afterText)),
    );

    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111113",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: beforeText,
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111114",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: afterText,
    });
    const outcome = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(outcome.report.status, "serialization_only");
    assert.equal(outcome.report.counters.total, 0);
  });

  it("clés avec / ~ et comparaison self", async () => {
    const projectRoot = await freshRoot();
    const weird = baseArticle();
    weird["a/b"] = 1;
    weird["c~d"] = 2;
    const body = bodyOf(weird);
    const meta = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111115",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: body,
    });
    const outcome = await runCompare({
      beforeMetaPath: meta,
      afterMetaPath: meta,
      projectRoot,
    });
    assert.equal(outcome.report.status, "identical");

    const removed = { ...weird };
    delete removed["a/b"];
    const after = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111116",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: bodyOf(removed),
    });
    const diffed = await runCompare({
      beforeMetaPath: meta,
      afterMetaPath: after,
      projectRoot,
    });
    assert.ok(diffed.report.differences.some((d) => d.path.includes("~1")));
  });

  it("refuse article différent, environnement différent, ordre chronologique inversé, hash incorrect", async () => {
    const projectRoot = await freshRoot();
    const body = bodyOf(baseArticle());
    const before = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111117",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: body,
    });
    const afterEarlier = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111118",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: body,
    });
    await assert.rejects(
      () =>
        runCompare({
          beforeMetaPath: before,
          afterMetaPath: afterEarlier,
          projectRoot,
        }),
      (e: unknown) => isCompareError(e) && /chronologique/i.test(e.message),
    );

    const otherEnv = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111119",
      collectedAtUtc: "2026-01-03T00:00:00.000Z",
      bodyText: body,
      environment: "production",
    });
    await assert.rejects(
      () =>
        runCompare({
          beforeMetaPath: before,
          afterMetaPath: otherEnv,
          projectRoot,
        }),
      (e: unknown) => isCompareError(e) && /Environnements/i.test(e.message),
    );

    const otherId = await writeCollection({
      projectRoot,
      collectionId: "11111111-1111-1111-1111-111111111120",
      collectedAtUtc: "2026-01-03T00:00:00.000Z",
      bodyText: bodyOf(baseArticle({ id: "LEGIARTI000023032086" })),
      requestedArticleId: "LEGIARTI000023032086",
    });
    await assert.rejects(
      () =>
        runCompare({
          beforeMetaPath: before,
          afterMetaPath: otherId,
          projectRoot,
        }),
      (e: unknown) => isCompareError(e) && /Identifiants/i.test(e.message),
    );

    // hash incorrect
    const badMetaRel = `data/collections/bad-hash.json`;
    await writeFile(
      path.join(projectRoot, badMetaRel),
      `${JSON.stringify({
        collectedAtUtc: "2026-01-04T00:00:00.000Z",
        collectionId: "11111111-1111-1111-1111-111111111121",
        environment: "sandbox",
        requestedArticleId: ARTICLE_ID,
        url: "https://example.test",
        httpStatus: 200,
        bodySha256: "0".repeat(64),
        bodyPath: JSON.parse(await readFile(path.join(projectRoot, before), "utf8")).bodyPath,
        collectionMetaPath: badMetaRel,
      })}\n`,
      "utf8",
    );
    await assert.rejects(
      () =>
        runCompare({
          beforeMetaPath: before,
          afterMetaPath: badMetaRel,
          projectRoot,
        }),
      (e: unknown) => isCompareError(e) && e.code === "HASH_MISMATCH",
    );
  });

  it("relance identique et conflit de sortie ; entrées inchangées", async () => {
    const projectRoot = await freshRoot();
    const beforeBody = bodyOf(baseArticle({ refInjection: "A" }));
    const afterBody = bodyOf(baseArticle({ refInjection: "B" }));
    const before = await writeCollection({
      projectRoot,
      collectionId: "22222222-2222-2222-2222-222222222201",
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      bodyText: beforeBody,
    });
    const after = await writeCollection({
      projectRoot,
      collectionId: "22222222-2222-2222-2222-222222222202",
      collectedAtUtc: "2026-01-02T00:00:00.000Z",
      bodyText: afterBody,
    });

    const beforeBytes = await readFile(path.join(projectRoot, before));
    const afterBytes = await readFile(path.join(projectRoot, after));

    const first = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(first.publishStatus, "written");

    const second = await runCompare({
      beforeMetaPath: before,
      afterMetaPath: after,
      projectRoot,
    });
    assert.equal(second.publishStatus, "already_identical");
    assert.equal(second.report.comparisonId, first.report.comparisonId);

    await writeFile(first.reportPathAbsolute, '{"tampered":true}\n', "utf8");
    await assert.rejects(
      () =>
        runCompare({
          beforeMetaPath: before,
          afterMetaPath: after,
          projectRoot,
        }),
      (e: unknown) => isCompareError(e) && e.code === "OUTPUT_CONFLICT",
    );

    assert.deepEqual(await readFile(path.join(projectRoot, before)), beforeBytes);
    assert.deepEqual(await readFile(path.join(projectRoot, after)), afterBytes);
  });
});

describe("vérification locale optionnelle (collectes réelles)", () => {
  it("compare 8fe226e5… et 8119d122… si présentes", async () => {
    const { fileURLToPath } = await import("node:url");
    const { readdir } = await import("node:fs/promises");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const dir = path.join(root, "data", "collections");
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    const beforeName = files.find((f) =>
      f.includes("8fe226e5-09f5-48d8-950e-06f03dc5cb22"),
    );
    const afterName = files.find((f) =>
      f.includes("8119d122-737f-483a-a46a-a731a39626da"),
    );
    if (!beforeName || !afterName) {
      return;
    }

    const before = `data/collections/${beforeName}`;
    const after = `data/collections/${afterName}`;
    const first = await runCompare({ beforeMetaPath: before, afterMetaPath: after });
    assert.equal(first.report.status, "technical_only");
    assert.equal(first.report.differences.length, 1);
    assert.equal(first.report.differences[0]?.path, "/article/refInjection");
    assert.equal(first.report.differences[0]?.category, "technical");

    const second = await runCompare({ beforeMetaPath: before, afterMetaPath: after });
    assert.equal(second.publishStatus, "already_identical");
    assert.equal(second.reportPathRelative, first.reportPathRelative);
  });
});

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
import { classifyReference, buildResolutionLookup } from "../src/relations/classify.js";
import { isRelationsError } from "../src/relations/errors.js";
import { runRelationInventory } from "../src/relations/run.js";
import type { NormalizedArticleDocument } from "../src/normalize/types.js";
import type { BatchReport } from "../src/batch/types.js";

const ROOTS: string[] = [];

after(async () => {
  for (const root of ROOTS) {
    await rm(root, { recursive: true, force: true });
  }
});

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "relations-inv-"));
  ROOTS.push(root);
  await mkdir(path.join(root, "data", "batches"), { recursive: true });
  await mkdir(path.join(root, "data", "normalized"), { recursive: true });
  await mkdir(path.join(root, "data", "relation-inventories"), {
    recursive: true,
  });
  return root;
}

function normalizedDoc(input: {
  collectionId: string;
  articleId: string;
  articleNum: string;
  bodySha256: string;
  articleVersions?: Array<{ id: string; version?: string }>;
  lienCitations?: unknown[];
  lienModifications?: unknown[];
  lienConcordes?: unknown[];
  lienAutres?: unknown[];
}): NormalizedArticleDocument {
  return {
    schemaVersion: 1,
    normalizerVersion: "1.0.0",
    provenance: {
      collectionId: input.collectionId,
      collectedAtUtc: "2026-09-23T14:00:00.000Z",
      environment: "sandbox",
      requestedArticleId: input.articleId,
      apiUrl: "https://example.test/getArticle",
      bodySha256: input.bodySha256,
      bodyPath: `data/bodies/${input.bodySha256}.json`,
      collectionMetaPath: `data/collections/${input.collectionId}.json`,
    },
    identity: {
      id: input.articleId,
      cid: "CID",
      num: input.articleNum,
      origine: "LEGI",
      nature: null,
      type: "AUTONOME",
      versionArticle: "1.0",
      etat: "VIGUEUR",
    },
    content: {
      texte: "x",
      texteHtml: null,
      nota: null,
      notaHtml: null,
    },
    dates: {
      dateDebut: { status: "absent", raw: null, isoUtc: null },
      dateFin: { status: "absent", raw: null, isoUtc: null },
      dateDebutExtension: { status: "absent", raw: null, isoUtc: null },
      dateFinExtension: { status: "absent", raw: null, isoUtc: null },
    },
    context: {
      idTexte: null,
      cidTexte: null,
      textTitles: null,
      titreTxt: null,
      titresTM: null,
      sectionParentId: null,
      sectionParentCid: null,
      sectionParentTitre: null,
    },
    versions: {
      articleVersions: input.articleVersions ?? [
        { id: input.articleId, version: "1.0" },
      ],
      versionPrecedente: null,
    },
    relations: {
      lienCitations: input.lienCitations ?? [],
      lienModifications: input.lienModifications ?? [],
      lienConcordes: input.lienConcordes ?? [],
      lienAutres: input.lienAutres ?? [],
    },
    warnings: [],
  };
}

async function writeCorpus(root: string): Promise<{
  batchPath: string;
  batchId: string;
}> {
  const a = {
    collectionId: "col-a",
    articleId: "LEGIARTI000000000001",
    articleNum: "L4121-1",
    bodySha256: "aa".repeat(32),
  };
  const b = {
    collectionId: "col-b",
    articleId: "LEGIARTI000000000002",
    articleNum: "L4121-2",
    bodySha256: "bb".repeat(32),
  };
  const c = {
    collectionId: "col-c",
    articleId: "LEGIARTI000000000003",
    articleNum: "L4121-3",
    bodySha256: "cc".repeat(32),
  };
  const d = {
    collectionId: "col-d",
    articleId: "LEGIARTI000000000004",
    articleNum: "R4121-1",
    bodySha256: "dd".repeat(32),
  };

  const docs = [
    normalizedDoc({
      ...a,
      articleVersions: [
        { id: a.articleId, version: "3.0" },
        { id: "LEGIARTI000000009901", version: "2.0" },
      ],
      lienCitations: [
        {
          articleId: b.articleId,
          articleNum: b.articleNum,
          linkType: "CITATION",
          linkOrientation: "cible",
          textTitle: "vers B",
        },
        {
          articleId: "LEGIARTI000000009901",
          articleNum: "L4121-1",
          linkType: "CITATION",
          linkOrientation: "cible",
          textTitle: "ancienne version A",
        },
        {
          articleId: "LEGIARTI999999999999",
          articleNum: "X",
          linkType: "CITATION",
          linkOrientation: "cible",
        },
        {
          articleNum: "Y",
          linkType: "CITATION",
          linkOrientation: "source",
        },
      ],
    }),
    normalizedDoc({
      ...b,
      lienCitations: [
        {
          articleId: a.articleId,
          articleNum: a.articleNum,
          linkType: "CITATION",
          linkOrientation: "cible",
          textTitle: "vers A",
        },
      ],
    }),
    normalizedDoc({ ...c }),
    normalizedDoc({ ...d }),
  ];

  const results = [a, b, c, d].map((item, i) => {
    const normalizedPath = `data/normalized/${item.collectionId}_v1.0.0.json`;
    return {
      articleId: item.articleId,
      status: "success" as const,
      collectionId: item.collectionId,
      bodySha256: item.bodySha256,
      normalizedPath,
      collectionMetaPath: `data/collections/${item.collectionId}.json`,
      normalizationWarningCount: 0,
      order: i,
    };
  });

  for (let i = 0; i < docs.length; i += 1) {
    const item = [a, b, c, d][i]!;
    const filePath = path.join(
      root,
      "data",
      "normalized",
      `${item.collectionId}_v1.0.0.json`,
    );
    await writeFile(filePath, `${JSON.stringify(docs[i], null, 2)}\n`, "utf8");
  }

  const batchId = "batch-prevention-test";
  const batch: BatchReport = {
    schemaVersion: 1,
    batchId,
    startedAtUtc: "2026-09-23T14:00:00.000Z",
    finishedAtUtc: "2026-09-23T14:00:10.000Z",
    environment: "sandbox",
    inputPath: "config/articles-prevention.json",
    inputSha256: sha256Utf8("prevention"),
    requestedArticleIds: [a, b, c, d].map((x) => x.articleId),
    delayMs: 1000,
    status: "completed",
    results: results.map(({ order: _o, ...rest }) => rest),
    counters: {
      requested: 4,
      collected: 4,
      normalized: 4,
      failed: 0,
      notProcessed: 0,
    },
  };

  const batchPath = path.join(root, "data", "batches", `${batchId}.json`);
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  return { batchPath: `data/batches/${batchId}.json`, batchId };
}

describe("classifyReference", () => {
  it("classe version_collectee, autre_version_connue et non_resolue", () => {
    const lookup = {
      collectedById: new Map([["LEGIARTI1", "col-1"]]),
      knownVersionIds: new Set(["LEGIARTI1", "LEGIARTI_OLD"]),
    };
    assert.equal(
      classifyReference("LEGIARTI1", lookup).class,
      "version_collectee",
    );
    assert.equal(
      classifyReference("LEGIARTI_OLD", lookup).class,
      "autre_version_connue",
    );
    assert.equal(
      classifyReference("LEGIARTI_UNKNOWN", lookup).class,
      "non_resolue",
    );
    assert.equal(classifyReference(null, lookup).reason, "articleId_absent");
    assert.equal(classifyReference(42, lookup).reason, "articleId_type_inattendu");
    assert.equal(classifyReference("", lookup).reason, "articleId_vide");
  });

  it("n'apparie pas sur le seul numéro d'article", () => {
    const articles = [
      {
        document: {
          identity: { id: "LEGIARTI_A", num: "L4121-1" },
          provenance: { collectionId: "c1" },
          versions: {
            articleVersions: [{ id: "LEGIARTI_A_OLD" }],
          },
        },
      },
    ] as unknown as Parameters<typeof buildResolutionLookup>[0];
    const lookup = buildResolutionLookup(articles);
    assert.equal(lookup.collectedById.has("L4121-1"), false);
    assert.equal(lookup.knownVersionIds.has("LEGIARTI_A_OLD"), true);
  });
});

describe("runRelationInventory", () => {
  it("inventorie les relations entre versions collectées et les autres classes", async () => {
    const root = await createProject();
    const { batchPath } = await writeCorpus(root);

    const outcome = await runRelationInventory({
      batchPath,
      projectRoot: root,
    });

    assert.equal(outcome.publishStatus, "written");
    assert.equal(outcome.report.counters.total, 5);
    assert.equal(outcome.report.counters.byFamily.lienCitations, 5);
    assert.equal(outcome.report.counters.byResolution.version_collectee, 2);
    assert.equal(outcome.report.counters.byResolution.autre_version_connue, 1);
    assert.equal(outcome.report.counters.byResolution.non_resolue, 2);

    const collected = outcome.report.entries.filter(
      (e) => e.resolution.class === "version_collectee",
    );
    assert.equal(collected.length, 2);
    assert.ok(
      collected.some(
        (e) =>
          e.source.articleId === "LEGIARTI000000000001" &&
          e.articleId === "LEGIARTI000000000002",
      ),
    );
    assert.ok(
      collected.some(
        (e) =>
          e.source.articleId === "LEGIARTI000000000002" &&
          e.articleId === "LEGIARTI000000000001",
      ),
    );

    const known = outcome.report.entries.find(
      (e) => e.resolution.class === "autre_version_connue",
    );
    assert.equal(known?.articleId, "LEGIARTI000000009901");

    const unknown = outcome.report.entries.find(
      (e) => e.articleId === "LEGIARTI999999999999",
    );
    assert.equal(unknown?.resolution.class, "non_resolue");
    assert.equal(
      unknown?.resolution.reason,
      "articleId_hors_corpus_et_versions",
    );

    const absent = outcome.report.entries.find(
      (e) => e.resolution.reason === "articleId_absent",
    );
    assert.ok(absent);
    assert.equal(absent.pointer.family, "lienCitations");
    assert.equal(absent.pointer.index, 3);
    assert.ok(absent.pointer.normalizedPath.includes("col-a"));
  });

  it("refuse un rapport incomplet ou une provenance incohérente", async () => {
    const root = await createProject();
    const { batchPath } = await writeCorpus(root);
    const absoluteBatch = path.join(root, batchPath);
    const batch = JSON.parse(await readFile(absoluteBatch, "utf8")) as BatchReport;

    batch.results = batch.results.slice(0, 3);
    await writeFile(absoluteBatch, `${JSON.stringify(batch, null, 2)}\n`, "utf8");

    await assert.rejects(
      () =>
        runRelationInventory({
          batchPath,
          projectRoot: root,
        }),
      (error: unknown) => {
        assert.ok(isRelationsError(error));
        assert.equal(error.code, "RELATIONS_INPUT_INVALID");
        assert.match(error.message, /incomplet/i);
        return true;
      },
    );

    const root2 = await createProject();
    const written = await writeCorpus(root2);
    const abs2 = path.join(root2, written.batchPath);
    const batch2 = JSON.parse(await readFile(abs2, "utf8")) as BatchReport;
    const normPath = path.join(root2, batch2.results[0]!.normalizedPath!);
    const doc = JSON.parse(await readFile(normPath, "utf8")) as {
      provenance: { collectionId: string };
    };
    doc.provenance.collectionId = "tampered";
    await writeFile(normPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    await assert.rejects(
      () =>
        runRelationInventory({
          batchPath: written.batchPath,
          projectRoot: root2,
        }),
      (error: unknown) => {
        assert.ok(isRelationsError(error));
        assert.match(error.message, /collectionId incohérent/i);
        return true;
      },
    );
  });

  it("relance identique et conflit de publication", async () => {
    const root = await createProject();
    const { batchPath } = await writeCorpus(root);

    const first = await runRelationInventory({
      batchPath,
      projectRoot: root,
    });
    assert.equal(first.publishStatus, "written");

    const second = await runRelationInventory({
      batchPath,
      projectRoot: root,
    });
    assert.equal(second.publishStatus, "already_identical");
    assert.equal(second.report.inventoryId, first.report.inventoryId);

    const before = await readFile(first.reportPathAbsolute, "utf8");
    await writeFile(first.reportPathAbsolute, '{"tampered":true}\n', "utf8");

    await assert.rejects(
      () =>
        runRelationInventory({
          batchPath,
          projectRoot: root,
        }),
      (error: unknown) => {
        assert.ok(isRelationsError(error));
        assert.match(error.message, /conflit|différent|existe/i);
        return true;
      },
    );

    // restauration non nécessaire : le conflit est le comportement attendu
    assert.notEqual(before, '{"tampered":true}\n');
  });
});

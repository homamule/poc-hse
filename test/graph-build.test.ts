import { createHash } from "node:crypto";
import {
  access,
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
import { isGraphError } from "../src/graph/errors.js";
import { runGraphBuild } from "../src/graph/run.js";
import type { NormalizedArticleDocument } from "../src/normalize/types.js";
import type { RelationInventoryReport } from "../src/relations/types.js";

const ROOTS: string[] = [];
const REAL_INVENTORY =
  "data/relation-inventories/de11015b82fde062558e4659332f960a328999ae2283b75e20e78d61caccdef9.json";

after(async () => {
  for (const root of ROOTS) {
    await rm(root, { recursive: true, force: true });
  }
});

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "graph-build-"));
  ROOTS.push(root);
  await mkdir(path.join(root, "data", "normalized"), { recursive: true });
  await mkdir(path.join(root, "data", "relation-inventories"), {
    recursive: true,
  });
  await mkdir(path.join(root, "data", "graphs"), { recursive: true });
  return root;
}

function normalizedDoc(input: {
  collectionId: string;
  articleId: string;
  articleNum: string;
  cid: string;
  bodySha256: string;
  etat?: string;
  articleVersions: Array<{ id: string; version?: string }>;
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
      cid: input.cid,
      num: input.articleNum,
      origine: "LEGI",
      nature: null,
      type: "AUTONOME",
      versionArticle: "3.0",
      etat: input.etat ?? "VIGUEUR",
    },
    content: { texte: "x", texteHtml: null, nota: null, notaHtml: null },
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
      articleVersions: input.articleVersions,
      versionPrecedente: null,
    },
    relations: {
      lienCitations: [],
      lienModifications: [],
      lienConcordes: [],
      lienAutres: [],
    },
    warnings: [],
  };
}

async function writeFixture(root: string): Promise<{ inventoryPath: string }> {
  const A = {
    collectionId: "col-a",
    articleId: "LEGIARTI000035640828",
    articleNum: "L4121-1",
    cid: "CID-A",
    bodySha256: "aa".repeat(32),
    historicalId: "LEGIARTI000006903147",
  };
  const B = {
    collectionId: "col-b",
    articleId: "LEGIARTI000033019913",
    articleNum: "L4121-2",
    cid: "CID-B",
    bodySha256: "bb".repeat(32),
  };
  const C = {
    collectionId: "col-c",
    articleId: "LEGIARTI000043893923",
    articleNum: "L4121-3",
    cid: "CID-C",
    bodySha256: "cc".repeat(32),
    historicalId: "LEGIARTI000006903149",
  };
  const D = {
    collectionId: "col-d",
    articleId: "LEGIARTI000023795562",
    articleNum: "R4121-1",
    cid: "CID-D",
    bodySha256: "dd".repeat(32),
  };

  const docs = [
    normalizedDoc({
      ...A,
      articleVersions: [
        { id: A.historicalId, version: "1.0" },
        { id: A.articleId, version: "3.0" },
      ],
    }),
    normalizedDoc({
      ...B,
      articleVersions: [
        { id: "LEGIARTI000006903148", version: "1.0" },
        { id: B.articleId, version: "3.0" },
      ],
    }),
    normalizedDoc({
      ...C,
      articleVersions: [
        { id: C.historicalId, version: "1.0" },
        { id: C.articleId, version: "3.0" },
      ],
    }),
    normalizedDoc({
      ...D,
      articleVersions: [
        { id: "LEGIARTI000018532912", version: "1.0" },
        { id: D.articleId, version: "2.0" },
      ],
    }),
  ];

  const corpus = [A, B, C, D].map((item, i) => {
    const normalizedPath = `data/normalized/${item.collectionId}_v1.0.0.json`;
    return {
      item,
      normalizedPath,
      doc: docs[i]!,
    };
  });

  for (const entry of corpus) {
    await writeFile(
      path.join(root, entry.normalizedPath),
      `${JSON.stringify(entry.doc, null, 2)}\n`,
      "utf8",
    );
  }

  const inventoryId = sha256Utf8("fixture-inventory");
  const inventory: RelationInventoryReport = {
    schemaVersion: 1,
    inventoryPolicyVersion: "1.0.0",
    inventoryId,
    batchId: "batch-fixture",
    batchPath: "data/batches/batch-fixture.json",
    corpus: corpus.map(({ item, normalizedPath }) => ({
      collectionId: item.collectionId,
      articleId: item.articleId,
      articleNum: item.articleNum,
      bodySha256: item.bodySha256,
      normalizedPath,
    })),
    counters: {
      total: 6,
      byFamily: {
        lienCitations: 6,
        lienModifications: 0,
        lienConcordes: 0,
        lienAutres: 0,
      },
      byResolution: {
        version_collectee: 2,
        autre_version_connue: 2,
        non_resolue: 2,
      },
    },
    entries: [
      {
        source: {
          articleId: A.articleId,
          articleNum: A.articleNum,
          collectionId: A.collectionId,
        },
        family: "lienCitations",
        index: 0,
        articleId: "JORFARTI_UNKNOWN",
        articleNum: "",
        linkType: "CITATION",
        linkOrientation: "cible",
        sourceFields: {},
        resolution: {
          class: "non_resolue",
          reason: "articleId_hors_corpus_et_versions",
        },
        pointer: {
          normalizedPath: corpus[0]!.normalizedPath,
          family: "lienCitations",
          index: 0,
        },
      },
      {
        source: {
          articleId: A.articleId,
          articleNum: A.articleNum,
          collectionId: A.collectionId,
        },
        family: "lienCitations",
        index: 1,
        articleId: B.articleId,
        articleNum: B.articleNum,
        linkType: "CITATION",
        linkOrientation: "cible",
        sourceFields: {},
        resolution: {
          class: "version_collectee",
          matchedCollectionId: B.collectionId,
        },
        pointer: {
          normalizedPath: corpus[0]!.normalizedPath,
          family: "lienCitations",
          index: 1,
        },
      },
      {
        source: {
          articleId: B.articleId,
          articleNum: B.articleNum,
          collectionId: B.collectionId,
        },
        family: "lienCitations",
        index: 0,
        articleId: A.historicalId,
        articleNum: "L4121-1",
        linkType: "CITATION",
        linkOrientation: "source",
        sourceFields: {},
        resolution: { class: "autre_version_connue" },
        pointer: {
          normalizedPath: corpus[1]!.normalizedPath,
          family: "lienCitations",
          index: 0,
        },
      },
      {
        source: {
          articleId: C.articleId,
          articleNum: C.articleNum,
          collectionId: C.collectionId,
        },
        family: "lienCitations",
        index: 0,
        articleId: D.articleId,
        articleNum: D.articleNum,
        linkType: "CITATION",
        linkOrientation: "cible",
        sourceFields: {},
        resolution: {
          class: "version_collectee",
          matchedCollectionId: D.collectionId,
        },
        pointer: {
          normalizedPath: corpus[2]!.normalizedPath,
          family: "lienCitations",
          index: 0,
        },
      },
      {
        source: {
          articleId: D.articleId,
          articleNum: D.articleNum,
          collectionId: D.collectionId,
        },
        family: "lienCitations",
        index: 0,
        articleId: C.historicalId,
        articleNum: "L4121-3",
        linkType: "CITATION",
        linkOrientation: "source",
        sourceFields: {},
        resolution: { class: "autre_version_connue" },
        pointer: {
          normalizedPath: corpus[3]!.normalizedPath,
          family: "lienCitations",
          index: 0,
        },
      },
      {
        source: {
          articleId: D.articleId,
          articleNum: D.articleNum,
          collectionId: D.collectionId,
        },
        family: "lienCitations",
        index: 1,
        articleId: null,
        articleNum: null,
        linkType: "CITATION",
        linkOrientation: "cible",
        sourceFields: {},
        resolution: { class: "non_resolue", reason: "articleId_absent" },
        pointer: {
          normalizedPath: corpus[3]!.normalizedPath,
          family: "lienCitations",
          index: 1,
        },
      },
    ],
  };

  // Note: historical A is confirmed via A's articleVersions, but entry comes from B.
  // Spec: confirm via articleVersions in ANY corpus normalized file.
  // A.historicalId is in A's versions — OK.
  // C.historicalId is in C's versions — but entry is from D. D's versions don't include C.historicalId!
  // Real data: LEGIARTI000006903149 is in L4121-3's articleVersions, and the autre_version_connue
  // entry is FROM R4121-1 pointing TO that id — confirmation is global across corpus versions.
  // So C.historicalId in C's articleVersions is enough.

  const inventoryPath = `data/relation-inventories/${inventoryId}.json`;
  await writeFile(
    path.join(root, inventoryPath),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
  return { inventoryPath };
}

describe("runGraphBuild", () => {
  it("projette les comptes attendus et distingue les versions d'un même article", async () => {
    const root = await createProject();
    const { inventoryPath } = await writeFixture(root);

    const outcome = await runGraphBuild({
      inventoryPath,
      projectRoot: root,
    });

    assert.equal(outcome.publishStatus, "written");
    assert.equal(outcome.graph.metadata.articleVersionsCollected, 4);
    assert.equal(outcome.graph.metadata.articleVersionsHistorical, 2);
    assert.equal(outcome.graph.metadata.relationSources, 4);
    assert.equal(outcome.graph.metadata.links, 8);
    assert.equal(outcome.graph.metadata.nonResolueCount, 2);
    assert.equal(outcome.graph.metadata.projectedEntryCount, 4);

    const collected = outcome.graph.nodes.articleVersions.filter(
      (n) => n.collected,
    );
    const historical = outcome.graph.nodes.articleVersions.filter(
      (n) => !n.collected,
    );
    assert.equal(collected.length, 4);
    assert.equal(historical.length, 2);

    const collectedL4121 = collected.find((n) => n.id === "LEGIARTI000035640828");
    const historicalL4121 = historical.find(
      (n) => n.id === "LEGIARTI000006903147",
    );
    assert.ok(collectedL4121);
    assert.ok(historicalL4121);
    assert.equal(collectedL4121.num, "L4121-1");
    assert.equal(historicalL4121.articleNum, "L4121-1");
    assert.notEqual(collectedL4121.id, historicalL4121.id);
    assert.equal("etat" in historicalL4121, false);
    assert.equal("collectionId" in historicalL4121, false);

    assert.ok(collectedL4121.collectionId);
    assert.ok(collectedL4121.bodySha256);
    assert.ok(collectedL4121.normalizedPath);
    assert.equal(collectedL4121.etat, "VIGUEUR");

    for (const link of outcome.graph.links) {
      assert.ok(
        link.type === "OBSERVATION_DANS" ||
          link.type === "REFERENCE_IDENTIFIANT",
      );
    }
    assert.equal(
      outcome.graph.links.filter((l) => l.type === "OBSERVATION_DANS").length,
      4,
    );
    assert.equal(
      outcome.graph.links.filter((l) => l.type === "REFERENCE_IDENTIFIANT")
        .length,
      4,
    );

    for (const rs of outcome.graph.nodes.relationSources) {
      assert.equal(rs.referencedArticleId.length > 0, true);
      const target = outcome.graph.nodes.articleVersions.find(
        (n) => n.id === rs.referencedArticleId,
      );
      assert.ok(target);
      const refLink = outcome.graph.links.find(
        (l) =>
          l.type === "REFERENCE_IDENTIFIANT" &&
          l.from === rs.id &&
          l.to === rs.referencedArticleId,
      );
      assert.ok(refLink);
    }
  });

  it("rejette un inventaire altéré ou une cible historique non confirmée", async () => {
    const root = await createProject();
    const { inventoryPath } = await writeFixture(root);
    const abs = path.join(root, inventoryPath);
    const inventory = JSON.parse(
      await readFile(abs, "utf8"),
    ) as RelationInventoryReport;

    inventory.counters.byResolution.non_resolue = 99;
    await writeFile(abs, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => runGraphBuild({ inventoryPath, projectRoot: root }),
      (error: unknown) => {
        assert.ok(isGraphError(error));
        assert.match(error.message, /incohérent/i);
        return true;
      },
    );

    const root2 = await createProject();
    const written = await writeFixture(root2);
    const abs2 = path.join(root2, written.inventoryPath);
    const inv2 = JSON.parse(
      await readFile(abs2, "utf8"),
    ) as RelationInventoryReport;
    const hist = inv2.entries.find(
      (e) => e.resolution.class === "autre_version_connue",
    );
    assert.ok(hist);
    hist.articleId = "LEGIARTI000099999999";
    // counters still match entry count/classes
    await writeFile(abs2, `${JSON.stringify(inv2, null, 2)}\n`, "utf8");

    await assert.rejects(
      () =>
        runGraphBuild({
          inventoryPath: written.inventoryPath,
          projectRoot: root2,
        }),
      (error: unknown) => {
        assert.ok(isGraphError(error));
        assert.match(error.message, /non confirmée|articleVersions/i);
        return true;
      },
    );
  });

  it("relance identique et conflit de publication", async () => {
    const root = await createProject();
    const { inventoryPath } = await writeFixture(root);

    const first = await runGraphBuild({ inventoryPath, projectRoot: root });
    assert.equal(first.publishStatus, "written");

    const second = await runGraphBuild({ inventoryPath, projectRoot: root });
    assert.equal(second.publishStatus, "already_identical");
    assert.equal(second.graph.graphId, first.graph.graphId);

    await writeFile(first.graphPathAbsolute, '{"tampered":true}\n', "utf8");
    await assert.rejects(
      () => runGraphBuild({ inventoryPath, projectRoot: root }),
      (error: unknown) => {
        assert.ok(isGraphError(error));
        assert.match(error.message, /différent|existe/i);
        return true;
      },
    );
  });
});

describe("vérification locale optionnelle (inventaire prévention réel)", () => {
  it("compte 4+2 ArticleVersion, 4 RelationSource, 8 liens, 434 non_resolue", async () => {
    try {
      await access(REAL_INVENTORY);
    } catch {
      return;
    }

    const outcome = await runGraphBuild({ inventoryPath: REAL_INVENTORY });
    assert.equal(outcome.graph.metadata.articleVersionsCollected, 4);
    assert.equal(outcome.graph.metadata.articleVersionsHistorical, 2);
    assert.equal(outcome.graph.metadata.relationSources, 4);
    assert.equal(outcome.graph.metadata.links, 8);
    assert.equal(outcome.graph.metadata.nonResolueCount, 434);

    const collected = outcome.graph.nodes.articleVersions.filter(
      (n) => n.collected,
    );
    const historical = outcome.graph.nodes.articleVersions.filter(
      (n) => !n.collected,
    );
    assert.deepEqual(
      collected.map((n) => n.id).sort(),
      [
        "LEGIARTI000023795562",
        "LEGIARTI000033019913",
        "LEGIARTI000035640828",
        "LEGIARTI000043893923",
      ],
    );
    assert.deepEqual(
      historical.map((n) => n.id).sort(),
      ["LEGIARTI000006903147", "LEGIARTI000006903149"],
    );

    const sameNum = [
      collected.find((n) => n.id === "LEGIARTI000035640828"),
      historical.find((n) => n.id === "LEGIARTI000006903147"),
    ];
    assert.ok(sameNum[0] && sameNum[1]);
    assert.equal(sameNum[0].collected, true);
    assert.equal(sameNum[1].collected, false);
    if (sameNum[0].collected) {
      assert.equal(sameNum[0].num, "L4121-1");
    }
    if (!sameNum[1].collected) {
      assert.equal(sameNum[1].articleNum, "L4121-1");
    }
  });
});

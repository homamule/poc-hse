import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCollection } from "../src/normalize/run.js";
import { isNormalizeError } from "../src/normalize/errors.js";
import { normalizeArticleDate } from "../src/normalize/dates.js";
import {
  buildNormalizedArticleDocument,
  serializeNormalizedDocument,
} from "../src/normalize/build.js";
import type { NormalizeWarning } from "../src/normalize/types.js";

const ARTICLE_ID = "LEGIARTI000000000001";
const ARTICLE_CID = "LEGIARTI000000000099";
const COLLECTION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const SAMPLE_TEXTE =
  "L'employeur prend les mesures nécessaires pour assurer la sécurité.";
const SAMPLE_HTML = `<p>${SAMPLE_TEXTE}</p>`;

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildArticleFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ARTICLE_ID,
    cid: ARTICLE_CID,
    num: "L4121-1",
    origine: "LEGI",
    nature: "Article",
    type: "AUTONOME",
    versionArticle: "3.0",
    etat: "VIGUEUR",
    texte: SAMPLE_TEXTE,
    texteHtml: SAMPLE_HTML,
    nota: "Nota de test.",
    notaHtml: "<p>Nota de test.</p>",
    idTexte: null,
    cidTexte: null,
    dateDebut: 1506816000000,
    dateFin: 32472144000000,
    dateDebutExtension: 32472144000000,
    dateFinExtension: 32472144000000,
    textTitles: [
      {
        id: "LEGITEXT000006072050",
        titre: "Code du travail",
        cid: "LEGITEXT000006072050",
      },
    ],
    context: {
      titreTxt: [{ id: "LEGITEXT000006072050", titre: "Code du travail" }],
      titresTM: [
        { id: "LEGISCTA0001", titre: "Partie législative" },
        { id: "LEGISCTA0002", titre: "Chapitre Ier" },
      ],
      nombreVersionParent: 1,
      longeurChemin: 2,
    },
    sectionParentId: "LEGISCTA000006178066",
    sectionParentCid: "LEGISCTA000006178066",
    sectionParentTitre: "Chapitre Ier : Obligations de l'employeur.",
    articleVersions: [
      { id: "LEGIARTI000000000001", version: "3.0" },
      { id: "LEGIARTI000000000000", version: "2.0" },
    ],
    versionPrecedente: "LEGIARTI000000000000",
    lienCitations: [
      {
        articleId: "JORFARTI000019673015",
        linkType: "CITATION",
        linkOrientation: "cible",
        textCid: "JORFTEXT000019673014",
      },
      {
        articleId: "JORFARTI000019673015",
        linkType: "CITATION",
        linkOrientation: "cible",
        textCid: "JORFTEXT000019673014",
      },
    ],
    lienModifications: [
      {
        articleId: "JORFTEXT000000465978",
        linkType: "CODIFICATION",
        linkOrientation: "source",
        textTitle: "Ordonnance n°2007-329",
      },
    ],
    lienConcordes: [
      {
        articleId: "LEGIARTI000099",
        linkType: "CONCORDE",
        linkOrientation: "cible",
      },
    ],
    lienAutres: [],
    ...overrides,
  };
}

async function createFixtureProject(options?: {
  articleOverrides?: Record<string, unknown>;
  bodyCorrupt?: "hash" | "json" | "missing-body" | "id-mismatch";
  collectionId?: string;
}): Promise<{
  projectRoot: string;
  collectionMetaRel: string;
  bodyRel: string;
  bodyAbs: string;
  metaAbs: string;
  bodyText: string;
  cleanup: () => Promise<void>;
}> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "graphrag-norm-"));
  const bodiesDir = path.join(projectRoot, "data", "bodies");
  const collectionsDir = path.join(projectRoot, "data", "collections");
  await mkdir(bodiesDir, { recursive: true });
  await mkdir(collectionsDir, { recursive: true });

  const collectionId = options?.collectionId ?? COLLECTION_ID;
  let article = buildArticleFixture(options?.articleOverrides);
  if (options?.bodyCorrupt === "id-mismatch") {
    article = buildArticleFixture({ id: "LEGIARTI000000000999" });
  }

  const bodyObj = { article };
  let bodyText = `${JSON.stringify(bodyObj)}\n`;
  if (options?.bodyCorrupt === "json") {
    bodyText = "{not-json";
  }

  const sha = sha256Utf8(bodyText);
  const bodyRel = `data/bodies/${sha}.json`;
  const bodyAbs = path.join(projectRoot, bodyRel);

  if (options?.bodyCorrupt !== "missing-body") {
    await writeFile(bodyAbs, bodyText, "utf8");
  }

  const metaName = `2026-01-01T00-00-00-000Z_${ARTICLE_ID}_${collectionId}.json`;
  const collectionMetaRel = `data/collections/${metaName}`;
  const metaAbs = path.join(projectRoot, collectionMetaRel);

  const metadata = {
    collectedAtUtc: "2026-01-01T00:00:00.000Z",
    collectionId,
    environment: "sandbox",
    requestedArticleId: ARTICLE_ID,
    url: "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/getArticle",
    httpStatus: 200,
    bodySha256:
      options?.bodyCorrupt === "hash"
        ? "0".repeat(64)
        : sha,
    bodyPath: bodyRel,
    bodyAlreadyExisted: false,
    collectionMetaPath: collectionMetaRel,
  };

  await writeFile(metaAbs, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return {
    projectRoot,
    collectionMetaRel,
    bodyRel,
    bodyAbs,
    metaAbs,
    bodyText,
    cleanup: async () => {
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

describe("normalizeArticleDate", () => {
  it("convertit les millisecondes en ISO UTC et conserve 2999", () => {
    const warnings: NormalizeWarning[] = [];
    const debut = normalizeArticleDate(1506816000000, "dates.dateDebut", warnings);
    assert.equal(debut.status, "ok");
    if (debut.status === "ok") {
      assert.equal(debut.isoUtc, "2017-10-01T00:00:00.000Z");
    }

    const fin = normalizeArticleDate(32472144000000, "dates.dateFin", warnings);
    assert.equal(fin.status, "ok");
    if (fin.status === "ok") {
      assert.equal(fin.isoUtc, "2999-01-01T00:00:00.000Z");
    }
    assert.ok(warnings.some((w) => w.code === "DATE_SENTINEL_2999"));
  });

  it("distingue absent et invalide", () => {
    const warnings: NormalizeWarning[] = [];
    assert.equal(
      normalizeArticleDate(undefined, "dates.dateDebut", warnings).status,
      "absent",
    );
    assert.equal(
      normalizeArticleDate("2017-10-01", "dates.dateFin", warnings).status,
      "invalid",
    );
    assert.ok(warnings.some((w) => w.code === "DATE_INVALID"));
  });
});

describe("normalizeCollection", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  it("normalisation valide avec préservation des textes, id/cid, relations et dates", async () => {
    const fx = await createFixtureProject();
    cleanups.push(fx.cleanup);

    const result = await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });

    assert.equal(result.status, "written");
    const doc = result.document;

    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.normalizerVersion, "1.0.0");
    assert.equal(doc.provenance.environment, "sandbox");
    assert.equal(doc.provenance.collectionId, COLLECTION_ID);
    assert.equal(doc.identity.id, ARTICLE_ID);
    assert.equal(doc.identity.cid, ARTICLE_CID);
    assert.notEqual(doc.identity.id, doc.identity.cid);
    assert.equal(doc.content.texte, SAMPLE_TEXTE);
    assert.equal(doc.content.texteHtml, SAMPLE_HTML);
    assert.equal(doc.context.idTexte, null);
    assert.equal(doc.context.cidTexte, null);
    assert.ok(Array.isArray(doc.context.textTitles));
    assert.ok(Array.isArray(doc.context.titreTxt));
    assert.ok(Array.isArray(doc.context.titresTM));
    assert.equal((doc.context.titresTM as unknown[]).length, 2);

    const citations = doc.relations.lienCitations as unknown[];
    assert.equal(citations.length, 2);
    assert.deepEqual(citations[0], citations[1]);
    const mod = (doc.relations.lienModifications as Array<Record<string, unknown>>)[0];
    assert.equal(mod?.linkOrientation, "source");
    assert.equal(mod?.linkType, "CODIFICATION");

    assert.equal(doc.dates.dateDebut.status, "ok");
    if (doc.dates.dateDebut.status === "ok") {
      assert.equal(doc.dates.dateDebut.raw, 1506816000000);
      assert.equal(doc.dates.dateDebut.isoUtc, "2017-10-01T00:00:00.000Z");
    }
    assert.equal(doc.dates.dateFin.status, "ok");
    if (doc.dates.dateFin.status === "ok") {
      assert.equal(doc.dates.dateFin.isoUtc, "2999-01-01T00:00:00.000Z");
    }
    assert.ok(doc.warnings.some((w) => w.code === "DATE_SENTINEL_2999"));

    const onDisk = await readFile(result.outputPathAbsolute, "utf8");
    assert.equal(onDisk, serializeNormalizedDocument(doc));
  });

  it("conserve le rattachement textTitles même si idTexte est null", async () => {
    const fx = await createFixtureProject();
    cleanups.push(fx.cleanup);
    const result = await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });
    assert.equal(result.document.context.idTexte, null);
    assert.ok(Array.isArray(result.document.context.textTitles));
    assert.equal(
      (result.document.context.textTitles as Array<{ titre: string }>)[0]?.titre,
      "Code du travail",
    );
  });

  it("ne fabrique pas de texte brut si seul texteHtml est présent", async () => {
    const article = buildArticleFixture();
    delete article.texte;
    const doc = buildNormalizedArticleDocument({
      article,
      provenance: {
        collectionId: COLLECTION_ID,
        collectedAtUtc: "2026-01-01T00:00:00.000Z",
        environment: "sandbox",
        requestedArticleId: ARTICLE_ID,
        apiUrl: "https://example.test",
        bodySha256: "a".repeat(64),
        bodyPath: "data/bodies/x.json",
        collectionMetaPath: "data/collections/x.json",
      },
    });
    assert.equal(doc.content.texte, null);
    assert.equal(doc.content.texteHtml, SAMPLE_HTML);
  });

  it("corps absent → erreur, aucune sortie", async () => {
    const fx = await createFixtureProject({ bodyCorrupt: "missing-body" });
    cleanups.push(fx.cleanup);
    await assert.rejects(
      () =>
        normalizeCollection({
          collectionMetaPath: fx.collectionMetaRel,
          projectRoot: fx.projectRoot,
        }),
      (error: unknown) => isNormalizeError(error) && error.code === "BODY_MISSING",
    );
    await assert.rejects(() =>
      access(path.join(fx.projectRoot, "data", "normalized")),
    );
  });

  it("JSON invalide → erreur", async () => {
    const fx = await createFixtureProject({ bodyCorrupt: "json" });
    cleanups.push(fx.cleanup);
    await assert.rejects(
      () =>
        normalizeCollection({
          collectionMetaPath: fx.collectionMetaRel,
          projectRoot: fx.projectRoot,
        }),
      (error: unknown) =>
        isNormalizeError(error) && error.code === "BODY_INVALID_JSON",
    );
  });

  it("hash incorrect → erreur", async () => {
    const fx = await createFixtureProject({ bodyCorrupt: "hash" });
    cleanups.push(fx.cleanup);
    await assert.rejects(
      () =>
        normalizeCollection({
          collectionMetaPath: fx.collectionMetaRel,
          projectRoot: fx.projectRoot,
        }),
      (error: unknown) => isNormalizeError(error) && error.code === "HASH_MISMATCH",
    );
  });

  it("identifiant incohérent → erreur", async () => {
    const fx = await createFixtureProject({ bodyCorrupt: "id-mismatch" });
    cleanups.push(fx.cleanup);
    await assert.rejects(
      () =>
        normalizeCollection({
          collectionMetaPath: fx.collectionMetaRel,
          projectRoot: fx.projectRoot,
        }),
      (error: unknown) =>
        isNormalizeError(error) && error.code === "ARTICLE_INVALID",
    );
  });

  it("deuxième normalisation identique sans réécriture", async () => {
    const fx = await createFixtureProject({
      collectionId: "11111111-1111-1111-1111-111111111111",
    });
    cleanups.push(fx.cleanup);

    const first = await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });
    assert.equal(first.status, "written");
    const firstContent = await readFile(first.outputPathAbsolute, "utf8");

    const second = await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });
    assert.equal(second.status, "already_normalized");
    const secondContent = await readFile(second.outputPathAbsolute, "utf8");
    assert.equal(secondContent, firstContent);
  });

  it("refuse d'écraser une sortie différente", async () => {
    const fx = await createFixtureProject({
      collectionId: "22222222-2222-2222-2222-222222222222",
    });
    cleanups.push(fx.cleanup);

    const first = await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });

    await writeFile(first.outputPathAbsolute, '{"tampered":true}\n', "utf8");

    await assert.rejects(
      () =>
        normalizeCollection({
          collectionMetaPath: fx.collectionMetaRel,
          projectRoot: fx.projectRoot,
        }),
      (error: unknown) =>
        isNormalizeError(error) && error.code === "OUTPUT_CONFLICT",
    );

    const onDisk = await readFile(first.outputPathAbsolute, "utf8");
    assert.equal(onDisk, '{"tampered":true}\n');
  });

  it("laisse les fichiers d'entrée inchangés", async () => {
    const fx = await createFixtureProject({
      collectionId: "33333333-3333-3333-3333-333333333333",
    });
    cleanups.push(fx.cleanup);

    const bodyBefore = await readFile(fx.bodyAbs);
    const metaBefore = await readFile(fx.metaAbs);

    await normalizeCollection({
      collectionMetaPath: fx.collectionMetaRel,
      projectRoot: fx.projectRoot,
    });

    const bodyAfter = await readFile(fx.bodyAbs);
    const metaAfter = await readFile(fx.metaAbs);
    assert.deepEqual(bodyAfter, bodyBefore);
    assert.deepEqual(metaAfter, metaBefore);
  });
});

describe("vérification locale optionnelle (data/ réel)", () => {
  it("normalise une collecte locale si présente, sans la modifier", async () => {
    const { fileURLToPath } = await import("node:url");
    const { readdir } = await import("node:fs/promises");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    const collectionsDir = path.join(root, "data", "collections");
    let metaFile: string | undefined;
    try {
      const files = await readdir(collectionsDir);
      metaFile = files.find((f) => f.endsWith(".json"));
    } catch {
      // pas de data locale
    }

    if (!metaFile) {
      // Les tests automatisés restent verts sans credentials ni data locale.
      return;
    }

    const metaRel = `data/collections/${metaFile}`;
    const metaAbs = path.join(root, metaRel);
    const metaBefore = await readFile(metaAbs);

    const metaJson = JSON.parse(metaBefore.toString("utf8")) as {
      bodyPath: string;
    };
    const bodyAbs = path.join(root, metaJson.bodyPath);
    const bodyBefore = await readFile(bodyAbs);

    const first = await normalizeCollection({ collectionMetaPath: metaRel });
    assert.ok(
      first.status === "written" || first.status === "already_normalized",
    );

    const second = await normalizeCollection({ collectionMetaPath: metaRel });
    assert.equal(second.status, "already_normalized");

    assert.deepEqual(await readFile(metaAbs), metaBefore);
    assert.deepEqual(await readFile(bodyAbs), bodyBefore);
  });
});

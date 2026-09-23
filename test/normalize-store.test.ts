import {
  access,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeNormalizedDocument } from "../src/normalize/build.js";
import { isNormalizeError } from "../src/normalize/errors.js";
import {
  writeNormalizedDocument,
  type NormalizedStoreFs,
} from "../src/normalize/store.js";
import type { NormalizedArticleDocument } from "../src/normalize/types.js";

function sampleDocument(collectionId: string): NormalizedArticleDocument {
  return {
    schemaVersion: 1,
    normalizerVersion: "1.0.0",
    provenance: {
      collectionId,
      collectedAtUtc: "2026-01-01T00:00:00.000Z",
      environment: "sandbox",
      requestedArticleId: "LEGIARTI000000000001",
      apiUrl: "https://example.test/consult/getArticle",
      bodySha256: "a".repeat(64),
      bodyPath: "data/bodies/a.json",
      collectionMetaPath: "data/collections/a.json",
    },
    identity: {
      id: "LEGIARTI000000000001",
      cid: "LEGIARTI000000000099",
      num: "L4121-1",
      origine: "LEGI",
      nature: "Article",
      type: "AUTONOME",
      versionArticle: "3.0",
      etat: "VIGUEUR",
    },
    content: {
      texte: "Contenu de test pour publication atomique.",
      texteHtml: "<p>Contenu de test pour publication atomique.</p>",
      nota: null,
      notaHtml: null,
    },
    dates: {
      dateDebut: {
        status: "ok",
        raw: 1506816000000,
        isoUtc: "2017-10-01T00:00:00.000Z",
      },
      dateFin: {
        status: "ok",
        raw: 32472144000000,
        isoUtc: "2999-01-01T00:00:00.000Z",
      },
      dateDebutExtension: { status: "absent", raw: null, isoUtc: null },
      dateFinExtension: { status: "absent", raw: null, isoUtc: null },
    },
    context: {
      idTexte: null,
      cidTexte: null,
      textTitles: [],
      titreTxt: null,
      titresTM: null,
      sectionParentId: null,
      sectionParentCid: null,
      sectionParentTitre: null,
    },
    versions: {
      articleVersions: null,
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

const baseFs: NormalizedStoreFs = {
  mkdir,
  access,
  readFile,
  open,
  link,
  unlink,
};

describe("writeNormalizedDocument — publication par lien physique", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  async function freshRoot(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "graphrag-store-"));
    cleanups.push(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });
    return projectRoot;
  }

  it("échec avant publication : aucune destination ni temporaire orphelin", async () => {
    const projectRoot = await freshRoot();
    const collectionId = "failwrite-0000-0000-0000-000000000001";
    const document = sampleDocument(collectionId);
    const normalizedDir = path.join(projectRoot, "data", "normalized");
    const finalPath = path.join(normalizedDir, `${collectionId}_v1.0.0.json`);

    const failingFs: NormalizedStoreFs = {
      ...baseFs,
      open: async (filePath, flags) => {
        const handle = await open(filePath, flags);
        return {
          writeFile: async () => {
            await handle.writeFile("PARTIAL_ONLY", "utf8");
            const err = new Error("Espace disque insuffisant (simulé)");
            (err as NodeJS.ErrnoException).code = "ENOSPC";
            throw err;
          },
          close: async () => handle.close(),
        } as Awaited<ReturnType<typeof open>>;
      },
    };

    await assert.rejects(
      () =>
        writeNormalizedDocument({
          document,
          projectRoot,
          fs: failingFs,
        }),
      (error: unknown) =>
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOSPC",
    );

    await assert.rejects(() => access(finalPath));

    await mkdir(normalizedDir, { recursive: true });
    const leftovers = await readdir(normalizedDir);
    assert.deepEqual(
      leftovers,
      [],
      `fichiers inattendus après échec : ${leftovers.join(", ")}`,
    );
  });

  it("deux publications concurrentes identiques : written + already_normalized", async () => {
    const projectRoot = await freshRoot();
    const collectionId = "concurrent-0000-0000-0000-000000000001";
    const document = sampleDocument(collectionId);
    const expected = serializeNormalizedDocument(document);
    const finalPath = path.join(
      projectRoot,
      "data",
      "normalized",
      `${collectionId}_v1.0.0.json`,
    );

    let linkCalls = 0;
    const concurrentFs: NormalizedStoreFs = {
      ...baseFs,
      link: async (existingPath, newPath) => {
        const call = ++linkCalls;
        if (call === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return link(existingPath, newPath);
      },
    };

    const [first, second] = await Promise.all([
      writeNormalizedDocument({
        document,
        projectRoot,
        fs: concurrentFs,
      }),
      writeNormalizedDocument({
        document,
        projectRoot,
        fs: concurrentFs,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, ["already_normalized", "written"]);

    const onDisk = await readFile(finalPath, "utf8");
    assert.equal(onDisk, expected);

    const leftovers = (await readdir(path.dirname(finalPath))).filter((name) =>
      name.endsWith(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  });

  it("destination différente : conflit sans écrasement", async () => {
    const projectRoot = await freshRoot();
    const collectionId = "conflict-0000-0000-0000-000000000001";
    const document = sampleDocument(collectionId);
    const normalizedDir = path.join(projectRoot, "data", "normalized");
    await mkdir(normalizedDir, { recursive: true });
    const finalPath = path.join(normalizedDir, `${collectionId}_v1.0.0.json`);
    const foreign = '{"foreign":true,"must":"remain"}\n';
    await writeFile(finalPath, foreign, "utf8");

    await assert.rejects(
      () =>
        writeNormalizedDocument({
          document,
          projectRoot,
        }),
      (error: unknown) =>
        isNormalizeError(error) && error.code === "OUTPUT_CONFLICT",
    );

    assert.equal(await readFile(finalPath, "utf8"), foreign);

    const leftovers = (await readdir(normalizedDir)).filter((name) =>
      name.endsWith(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  });

  it("échec de création du lien : temporaire nettoyé, destination préservée", async () => {
    const projectRoot = await freshRoot();
    const collectionId = "linkfail-0000-0000-0000-000000000001";
    const document = sampleDocument(collectionId);
    const normalizedDir = path.join(projectRoot, "data", "normalized");
    await mkdir(normalizedDir, { recursive: true });

    // Fichier voisin à préserver (ne doit pas être touché).
    const siblingPath = path.join(normalizedDir, "sibling-keep.json");
    const siblingContent = '{"keep":true}\n';
    await writeFile(siblingPath, siblingContent, "utf8");

    const finalPath = path.join(normalizedDir, `${collectionId}_v1.0.0.json`);

    const failingLinkFs: NormalizedStoreFs = {
      ...baseFs,
      link: async () => {
        const err = new Error("Cross-device link not permitted (simulé)");
        (err as NodeJS.ErrnoException).code = "EXDEV";
        throw err;
      },
    };

    await assert.rejects(
      () =>
        writeNormalizedDocument({
          document,
          projectRoot,
          fs: failingLinkFs,
        }),
      (error: unknown) => {
        if (!isNormalizeError(error) || error.code !== "LINK_UNSUPPORTED") {
          return false;
        }
        assert.match(error.message, /lien physique/i);
        assert.match(error.message, /Aucun repli vers copyFile/);
        return true;
      },
    );

    await assert.rejects(() => access(finalPath));
    assert.equal(await readFile(siblingPath, "utf8"), siblingContent);

    const leftovers = (await readdir(normalizedDir)).filter(
      (name) => name.endsWith(".tmp") || name === `${collectionId}_v1.0.0.json`,
    );
    assert.deepEqual(leftovers, []);
  });
});

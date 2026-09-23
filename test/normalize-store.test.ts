import {
  access,
  copyFile,
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
import {
  serializeNormalizedDocument,
} from "../src/normalize/build.js";
import { isNormalizeError } from "../src/normalize/errors.js";
import {
  writeNormalizedDocument,
  type NormalizedStoreFs,
} from "../src/normalize/store.js";
import type { NormalizedArticleDocument } from "../src/normalize/types.js";

function sampleDocument(
  collectionId: string,
): NormalizedArticleDocument {
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
  copyFile,
  unlink,
};

describe("writeNormalizedDocument — publication atomique", () => {
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

  it("échec d'écriture simulé : aucun fichier final partiel ni temporaire orphelin", async () => {
    const projectRoot = await freshRoot();
    const collectionId = "failwrite-0000-0000-0000-000000000001";
    const document = sampleDocument(collectionId);
    const normalizedDir = path.join(projectRoot, "data", "normalized");
    const finalName = `${collectionId}_v1.0.0.json`;
    const finalPath = path.join(normalizedDir, finalName);

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

  it("deux publications concurrentes identiques : une écriture, un déjà normalisé, sortie complète", async () => {
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

    let copyCalls = 0;
    const concurrentFs: NormalizedStoreFs = {
      ...baseFs,
      copyFile: async (src, dest, mode) => {
        const call = ++copyCalls;
        if (call === 1) {
          // Laisser la seconde tentative atteindre copyFile avant publication.
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return copyFile(src, dest, mode);
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
    assert.notEqual(onDisk.includes("PARTIAL"), true);

    const leftovers = (await readdir(path.dirname(finalPath))).filter((name) =>
      name.endsWith(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  });

  it("destination différente : aucun écrasement", async () => {
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
});

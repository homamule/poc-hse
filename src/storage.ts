import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CollectError } from "./errors.js";
import type { PisteEnv } from "./piste.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const BODIES_DIR = path.join(DATA_DIR, "bodies");
export const COLLECTIONS_DIR = path.join(DATA_DIR, "collections");

export type CollectionMetadata = {
  collectedAtUtc: string;
  collectionId: string;
  environment: PisteEnv;
  requestedArticleId: string;
  url: string;
  httpStatus: number;
  bodySha256: string;
  bodyPath: string;
  bodyAlreadyExisted: boolean;
  collectionMetaPath: string;
};

export type SaveResult = {
  sha256: string;
  bodyPath: string;
  bodyAlreadyExisted: boolean;
  collectionMetaPath: string;
  collectionId: string;
  metadata: CollectionMetadata;
};

export type SaveCollectionInput = {
  bodyText: string;
  environment: PisteEnv;
  requestedArticleId: string;
  url: string;
  httpStatus: number;
  collectedAtUtc?: string;
  /** Identifiant unique de collecte (UUID). Généré si omis. */
  collectionId?: string;
  /**
   * Répertoire data (contient bodies/ et collections/).
   * Défaut : data/ à la racine du projet.
   */
  dataDir?: string;
};

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/**
 * Enregistre le corps brut (dédupliqué par SHA-256) et une métadonnée
 * distincte pour chaque collecte réussie.
 * Le fichier de métadonnées est créé en mode exclusif (flag wx).
 */
export async function saveSuccessfulCollection(
  input: SaveCollectionInput,
): Promise<SaveResult> {
  const dataDir = input.dataDir ?? DATA_DIR;
  const pathRoot = path.dirname(dataDir);
  const bodiesDir = path.join(dataDir, "bodies");
  const collectionsDir = path.join(dataDir, "collections");

  await mkdir(bodiesDir, { recursive: true });
  await mkdir(collectionsDir, { recursive: true });

  const collectedAtUtc = input.collectedAtUtc ?? new Date().toISOString();
  const collectionId = input.collectionId ?? randomUUID();
  const sha256 = sha256Hex(input.bodyText);
  const bodyFileName = `${sha256}.json`;
  const bodyPath = path.join(bodiesDir, bodyFileName);
  const bodyAlreadyExisted = await pathExists(bodyPath);

  if (!bodyAlreadyExisted) {
    await writeFile(bodyPath, input.bodyText, "utf8");
  }

  const safeId = input.requestedArticleId.replace(/[^A-Za-z0-9._-]/g, "_");
  const stamp = collectedAtUtc.replace(/[:.]/g, "-");
  const metaFileName = `${stamp}_${safeId}_${collectionId}.json`;
  const collectionMetaPath = path.join(collectionsDir, metaFileName);

  const metadata: CollectionMetadata = {
    collectedAtUtc,
    collectionId,
    environment: input.environment,
    requestedArticleId: input.requestedArticleId,
    url: input.url,
    httpStatus: input.httpStatus,
    bodySha256: sha256,
    bodyPath: toPosixRelative(pathRoot, bodyPath),
    bodyAlreadyExisted,
    collectionMetaPath: toPosixRelative(pathRoot, collectionMetaPath),
  };

  try {
    await writeFile(
      collectionMetaPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (code === "EEXIST") {
      throw new CollectError(
        "STORAGE",
        "Collision de fichier de métadonnées : le fichier existe déjà. Aucun écrasement n'a été effectué.",
      );
    }
    throw error;
  }

  return {
    sha256,
    bodyPath,
    bodyAlreadyExisted,
    collectionMetaPath,
    collectionId,
    metadata,
  };
}

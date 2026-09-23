import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PisteEnv } from "./piste.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const BODIES_DIR = path.join(DATA_DIR, "bodies");
export const COLLECTIONS_DIR = path.join(DATA_DIR, "collections");

export type CollectionMetadata = {
  collectedAtUtc: string;
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
  metadata: CollectionMetadata;
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

/**
 * Enregistre le corps brut (dédupliqué par SHA-256) et une métadonnée
 * distincte pour chaque collecte réussie.
 */
export async function saveSuccessfulCollection(input: {
  bodyText: string;
  environment: PisteEnv;
  requestedArticleId: string;
  url: string;
  httpStatus: number;
  collectedAtUtc?: string;
}): Promise<SaveResult> {
  await mkdir(BODIES_DIR, { recursive: true });
  await mkdir(COLLECTIONS_DIR, { recursive: true });

  const collectedAtUtc = input.collectedAtUtc ?? new Date().toISOString();
  const sha256 = sha256Hex(input.bodyText);
  const bodyFileName = `${sha256}.json`;
  const bodyPath = path.join(BODIES_DIR, bodyFileName);
  const bodyAlreadyExisted = await pathExists(bodyPath);

  if (!bodyAlreadyExisted) {
    await writeFile(bodyPath, input.bodyText, "utf8");
  }

  const safeId = input.requestedArticleId.replace(/[^A-Za-z0-9._-]/g, "_");
  const stamp = collectedAtUtc.replace(/[:.]/g, "-");
  const metaFileName = `${stamp}_${safeId}.json`;
  const collectionMetaPath = path.join(COLLECTIONS_DIR, metaFileName);

  const metadata: CollectionMetadata = {
    collectedAtUtc,
    environment: input.environment,
    requestedArticleId: input.requestedArticleId,
    url: input.url,
    httpStatus: input.httpStatus,
    bodySha256: sha256,
    bodyPath: path.relative(ROOT_DIR, bodyPath).split(path.sep).join("/"),
    bodyAlreadyExisted,
    collectionMetaPath: path
      .relative(ROOT_DIR, collectionMetaPath)
      .split(path.sep)
      .join("/"),
  };

  await writeFile(collectionMetaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return {
    sha256,
    bodyPath,
    bodyAlreadyExisted,
    collectionMetaPath,
    metadata,
  };
}

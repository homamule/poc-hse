import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidGetArticleResponse } from "../article-validation.js";
import { NormalizeError } from "./errors.js";
import type { PisteEnv } from "../piste.js";

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function getProjectRoot(): string {
  return DEFAULT_PROJECT_ROOT;
}

export type CollectionMetadataInput = {
  collectedAtUtc: string;
  collectionId: string;
  environment: PisteEnv | string;
  requestedArticleId: string;
  url: string;
  httpStatus: number;
  bodySha256: string;
  bodyPath: string;
  collectionMetaPath?: string;
  bodyAlreadyExisted?: boolean;
};

export type LoadedCollection = {
  metadata: CollectionMetadataInput;
  metadataPathAbsolute: string;
  metadataPathRelative: string;
  bodyPathAbsolute: string;
  bodyPathRelative: string;
  bodyBytes: Buffer;
  bodyText: string;
  bodyJson: unknown;
  article: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringField(
  obj: Record<string, unknown>,
  key: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new NormalizeError(
      "METADATA_INVALID",
      `Métadonnées invalides : champ « ${key} » manquant ou vide.`,
    );
  }
  return value;
}

/**
 * Valide collectionId pour usage dans un nom de fichier (pas de traversal).
 */
export function assertSafeCollectionId(collectionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(collectionId)) {
    throw new NormalizeError(
      "METADATA_INVALID",
      "collectionId invalide pour un nom de fichier (caractères non autorisés).",
    );
  }
  if (
    collectionId === "." ||
    collectionId === ".." ||
    collectionId.includes("..")
  ) {
    throw new NormalizeError(
      "METADATA_INVALID",
      "collectionId invalide pour un nom de fichier.",
    );
  }
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Résout un chemin relatif du stockage (ex. data/bodies/…) depuis la racine projet.
 */
export function resolveDataPath(
  relativeOrAbsolute: string,
  projectRoot: string = DEFAULT_PROJECT_ROOT,
): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  return path.resolve(projectRoot, relativeOrAbsolute);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function parseCollectionMetadata(raw: unknown): CollectionMetadataInput {
  if (!isPlainObject(raw)) {
    throw new NormalizeError(
      "METADATA_INVALID",
      "Métadonnées invalides : objet JSON attendu.",
    );
  }

  const collectedAtUtc = requireStringField(raw, "collectedAtUtc");
  const collectionId = requireStringField(raw, "collectionId");
  assertSafeCollectionId(collectionId);
  const environment = requireStringField(raw, "environment");
  const requestedArticleId = requireStringField(raw, "requestedArticleId");
  const url = requireStringField(raw, "url");
  const bodySha256 = requireStringField(raw, "bodySha256");
  const bodyPath = requireStringField(raw, "bodyPath");

  if (typeof raw.httpStatus !== "number" || !Number.isFinite(raw.httpStatus)) {
    throw new NormalizeError(
      "METADATA_INVALID",
      "Métadonnées invalides : httpStatus numérique attendu.",
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(bodySha256)) {
    throw new NormalizeError(
      "METADATA_INVALID",
      "Métadonnées invalides : bodySha256 doit être un hex SHA-256 (64 caractères).",
    );
  }

  const result: CollectionMetadataInput = {
    collectedAtUtc,
    collectionId,
    environment,
    requestedArticleId,
    url,
    httpStatus: raw.httpStatus,
    bodySha256: bodySha256.toLowerCase(),
    bodyPath,
  };

  if (typeof raw.collectionMetaPath === "string") {
    result.collectionMetaPath = raw.collectionMetaPath;
  }
  if (typeof raw.bodyAlreadyExisted === "boolean") {
    result.bodyAlreadyExisted = raw.bodyAlreadyExisted;
  }

  return result;
}

/**
 * Charge et valide métadonnées + corps associés. Ne modifie aucun fichier.
 */
export async function loadCollectionForNormalize(
  collectionMetaPathArg: string,
  options: { projectRoot?: string } = {},
): Promise<LoadedCollection> {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const metadataPathAbsolute = resolveDataPath(
    collectionMetaPathArg,
    projectRoot,
  );

  if (!(await pathExists(metadataPathAbsolute))) {
    throw new NormalizeError(
      "METADATA_MISSING",
      `Fichier de métadonnées introuvable : ${collectionMetaPathArg}`,
    );
  }

  let metadataRawText: string;
  try {
    metadataRawText = await readFile(metadataPathAbsolute, "utf8");
  } catch {
    throw new NormalizeError(
      "METADATA_UNREADABLE",
      `Impossible de lire le fichier de métadonnées : ${collectionMetaPathArg}`,
    );
  }

  let metadataJson: unknown;
  try {
    metadataJson = JSON.parse(metadataRawText) as unknown;
  } catch {
    throw new NormalizeError(
      "METADATA_INVALID",
      "Métadonnées : JSON invalide.",
    );
  }

  const metadata = parseCollectionMetadata(metadataJson);
  const bodyPathAbsolute = resolveDataPath(metadata.bodyPath, projectRoot);

  if (!(await pathExists(bodyPathAbsolute))) {
    throw new NormalizeError(
      "BODY_MISSING",
      `Fichier du corps introuvable : ${metadata.bodyPath}`,
    );
  }

  let bodyBytes: Buffer;
  try {
    bodyBytes = await readFile(bodyPathAbsolute);
  } catch {
    throw new NormalizeError(
      "BODY_UNREADABLE",
      `Impossible de lire le corps : ${metadata.bodyPath}`,
    );
  }

  const computedSha = sha256Bytes(bodyBytes);
  if (computedSha !== metadata.bodySha256.toLowerCase()) {
    throw new NormalizeError(
      "HASH_MISMATCH",
      `SHA-256 du corps recalculé ne correspond pas à bodySha256 des métadonnées.`,
    );
  }

  const bodyText = bodyBytes.toString("utf8");
  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText) as unknown;
  } catch {
    throw new NormalizeError(
      "BODY_INVALID_JSON",
      "Corps : JSON invalide.",
    );
  }

  try {
    assertValidGetArticleResponse(bodyJson, metadata.requestedArticleId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Validation d'article échouée.";
    throw new NormalizeError("ARTICLE_INVALID", message);
  }

  if (!isPlainObject(bodyJson) || !isPlainObject(bodyJson.article)) {
    throw new NormalizeError(
      "ARTICLE_INVALID",
      "Corps : objet article attendu après validation.",
    );
  }

  const metadataPathRelative = toPosix(
    path.relative(projectRoot, metadataPathAbsolute),
  );
  const bodyPathRelative = toPosix(
    path.relative(projectRoot, bodyPathAbsolute),
  );

  return {
    metadata,
    metadataPathAbsolute,
    metadataPathRelative,
    bodyPathAbsolute,
    bodyPathRelative,
    bodyBytes,
    bodyText,
    bodyJson,
    article: bodyJson.article,
  };
}

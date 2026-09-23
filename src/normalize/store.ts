import {
  access,
  link,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NormalizeError } from "./errors.js";
import { assertSafeCollectionId, getProjectRoot } from "./load.js";
import {
  NORMALIZER_VERSION,
  type NormalizedArticleDocument,
} from "./types.js";
import { serializeNormalizedDocument } from "./build.js";

export type WriteNormalizedResult =
  | {
      status: "written";
      outputPathAbsolute: string;
      outputPathRelative: string;
      document: NormalizedArticleDocument;
    }
  | {
      status: "already_normalized";
      outputPathAbsolute: string;
      outputPathRelative: string;
      document: NormalizedArticleDocument;
    };

/** FS injectable pour les tests (écriture / publication). */
export type NormalizedStoreFs = {
  mkdir: typeof mkdir;
  access: typeof access;
  readFile: typeof readFile;
  open: typeof open;
  /** Lien physique uniquement (pas de lien symbolique). */
  link: typeof link;
  unlink: typeof unlink;
};

const defaultFs: NormalizedStoreFs = {
  mkdir,
  access,
  readFile,
  open,
  link,
  unlink,
};

/** Codes errno typiques lorsque le FS refuse un lien physique. */
const LINK_UNSUPPORTED_CODES = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EINVAL",
  "ENOSYS",
]);

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function normalizedOutputFileName(collectionId: string): string {
  assertSafeCollectionId(collectionId);
  return `${collectionId}_v${NORMALIZER_VERSION}.json`;
}

export function resolveNormalizedOutputPath(
  collectionId: string,
  projectRoot: string = getProjectRoot(),
): { absolute: string; relative: string; dir: string; fileName: string } {
  const dir = path.join(projectRoot, "data", "normalized");
  const fileName = normalizedOutputFileName(collectionId);
  const absolute = path.join(dir, fileName);
  const relative = toPosix(path.relative(projectRoot, absolute));
  return { absolute, relative, dir, fileName };
}

async function pathExists(
  filePath: string,
  fsImpl: NormalizedStoreFs,
): Promise<boolean> {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

async function compareExistingDestination(
  absolutePath: string,
  relativePath: string,
  serialized: string,
  document: NormalizedArticleDocument,
  fsImpl: NormalizedStoreFs,
): Promise<WriteNormalizedResult> {
  const existing = await fsImpl.readFile(absolutePath, "utf8");
  if (existing === serialized) {
    return {
      status: "already_normalized",
      outputPathAbsolute: absolutePath,
      outputPathRelative: relativePath,
      document,
    };
  }
  throw new NormalizeError(
    "OUTPUT_CONFLICT",
    `Le fichier normalisé existe déjà avec un contenu différent : ${relativePath}. Aucun écrasement effectué.`,
  );
}

async function removeTempQuietly(
  tmpPath: string | null,
  fsImpl: NormalizedStoreFs,
): Promise<void> {
  if (tmpPath === null) {
    return;
  }
  try {
    await fsImpl.unlink(tmpPath);
  } catch {
    // Nettoyage best-effort ; ne jamais toucher la destination.
  }
}

function linkPublicationError(error: unknown): NormalizeError {
  const code = errorCode(error);
  if (code !== undefined && LINK_UNSUPPORTED_CODES.has(code)) {
    return new NormalizeError(
      "LINK_UNSUPPORTED",
      `Publication impossible : le système de fichiers n'autorise pas la création d'un lien physique (fs.link, code ${code}). Requis : même volume, support des hard links (ex. NTFS sous Windows). Aucun repli vers copyFile.`,
    );
  }
  return new NormalizeError(
    "LINK_FAILED",
    `Échec de publication par lien physique (fs.link${code ? `, code ${code}` : ""}). Aucun repli vers copyFile.`,
  );
}

/**
 * Écrit entièrement dans un fichier temporaire du même dossier, ferme le
 * descripteur, puis publie via un lien physique (`fs.link`) sans écrasement
 * et sans recopier les octets. Compatible Windows/NTFS sur un même volume.
 * Pas de lien symbolique. Pas de repli silencieux vers copyFile.
 * Ne supprime jamais une destination existante.
 */
export async function writeNormalizedDocument(input: {
  document: NormalizedArticleDocument;
  projectRoot?: string;
  /** Surcharges FS pour tests ; fusionnées avec l'implémentation réelle. */
  fs?: Partial<NormalizedStoreFs>;
}): Promise<WriteNormalizedResult> {
  const fsImpl: NormalizedStoreFs = { ...defaultFs, ...input.fs };
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const serialized = serializeNormalizedDocument(input.document);
  const paths = resolveNormalizedOutputPath(
    input.document.provenance.collectionId,
    projectRoot,
  );

  await fsImpl.mkdir(paths.dir, { recursive: true });

  if (await pathExists(paths.absolute, fsImpl)) {
    return compareExistingDestination(
      paths.absolute,
      paths.relative,
      serialized,
      input.document,
      fsImpl,
    );
  }

  const tmpPath = path.join(
    paths.dir,
    `.${paths.fileName}.${randomUUID()}.tmp`,
  );
  let tmpCreated = false;

  try {
    const handle = await fsImpl.open(tmpPath, "wx");
    tmpCreated = true;
    try {
      await handle.writeFile(serialized, "utf8");
    } finally {
      await handle.close();
    }

    try {
      await fsImpl.link(tmpPath, paths.absolute);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        return compareExistingDestination(
          paths.absolute,
          paths.relative,
          serialized,
          input.document,
          fsImpl,
        );
      }
      throw linkPublicationError(error);
    }

    return {
      status: "written",
      outputPathAbsolute: paths.absolute,
      outputPathRelative: paths.relative,
      document: input.document,
    };
  } finally {
    if (tmpCreated) {
      await removeTempQuietly(tmpPath, fsImpl);
    }
  }
}

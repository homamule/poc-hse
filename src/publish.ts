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

export type PublishFs = {
  mkdir: typeof mkdir;
  access: typeof access;
  readFile: typeof readFile;
  open: typeof open;
  link: typeof link;
  unlink: typeof unlink;
};

const defaultFs: PublishFs = {
  mkdir,
  access,
  readFile,
  open,
  link,
  unlink,
};

const LINK_UNSUPPORTED_CODES = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EINVAL",
  "ENOSYS",
]);

export type PublishExclusiveResult =
  | { status: "written" }
  | { status: "already_identical" };

export class PublishError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isPublishError(error: unknown): error is PublishError {
  return error instanceof PublishError;
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

async function pathExists(
  filePath: string,
  fsImpl: PublishFs,
): Promise<boolean> {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeTempQuietly(
  tmpPath: string,
  fsImpl: PublishFs,
): Promise<void> {
  try {
    await fsImpl.unlink(tmpPath);
  } catch {
    // best-effort ; ne jamais toucher la destination
  }
}

function linkPublicationError(error: unknown): PublishError {
  const code = errorCode(error);
  if (code !== undefined && LINK_UNSUPPORTED_CODES.has(code)) {
    return new PublishError(
      "LINK_UNSUPPORTED",
      `Publication impossible : le système de fichiers n'autorise pas la création d'un lien physique (fs.link, code ${code}). Requis : même volume, support des hard links (ex. NTFS sous Windows). Aucun repli vers copyFile.`,
    );
  }
  return new PublishError(
    "LINK_FAILED",
    `Échec de publication par lien physique (fs.link${code ? `, code ${code}` : ""}). Aucun repli vers copyFile.`,
  );
}

/**
 * Publie un texte UTF-8 sans écrasement :
 * temporaire du même dossier → fermeture → fs.link → nettoyage du temporaire.
 */
export async function publishExclusiveTextFile(input: {
  content: string;
  destinationAbsolute: string;
  /** Libellé relatif pour les messages d'erreur. */
  destinationLabel?: string;
  fs?: Partial<PublishFs>;
}): Promise<PublishExclusiveResult> {
  const fsImpl: PublishFs = { ...defaultFs, ...input.fs };
  const destinationAbsolute = input.destinationAbsolute;
  const label = input.destinationLabel ?? destinationAbsolute;
  const dir = path.dirname(destinationAbsolute);
  const fileName = path.basename(destinationAbsolute);

  await fsImpl.mkdir(dir, { recursive: true });

  if (await pathExists(destinationAbsolute, fsImpl)) {
    const existing = await fsImpl.readFile(destinationAbsolute, "utf8");
    if (existing === input.content) {
      return { status: "already_identical" };
    }
    throw new PublishError(
      "OUTPUT_CONFLICT",
      `Le fichier existe déjà avec un contenu différent : ${label}. Aucun écrasement effectué.`,
    );
  }

  const tmpPath = path.join(dir, `.${fileName}.${randomUUID()}.tmp`);
  let tmpCreated = false;

  try {
    const handle = await fsImpl.open(tmpPath, "wx");
    tmpCreated = true;
    try {
      await handle.writeFile(input.content, "utf8");
    } finally {
      await handle.close();
    }

    try {
      await fsImpl.link(tmpPath, destinationAbsolute);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        const existing = await fsImpl.readFile(destinationAbsolute, "utf8");
        if (existing === input.content) {
          return { status: "already_identical" };
        }
        throw new PublishError(
          "OUTPUT_CONFLICT",
          `Le fichier existe déjà avec un contenu différent : ${label}. Aucun écrasement effectué.`,
        );
      }
      throw linkPublicationError(error);
    }

    return { status: "written" };
  } finally {
    if (tmpCreated) {
      await removeTempQuietly(tmpPath, fsImpl);
    }
  }
}

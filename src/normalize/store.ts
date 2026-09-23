import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
): { absolute: string; relative: string; dir: string } {
  const dir = path.join(projectRoot, "data", "normalized");
  const fileName = normalizedOutputFileName(collectionId);
  const absolute = path.join(dir, fileName);
  const relative = toPosix(path.relative(projectRoot, absolute));
  return { absolute, relative, dir };
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
 * Écrit le document normalisé de façon déterministe, sans écrasement.
 * Compatible Windows : flag wx (création exclusive).
 */
export async function writeNormalizedDocument(input: {
  document: NormalizedArticleDocument;
  projectRoot?: string;
}): Promise<WriteNormalizedResult> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const serialized = serializeNormalizedDocument(input.document);
  const paths = resolveNormalizedOutputPath(
    input.document.provenance.collectionId,
    projectRoot,
  );

  await mkdir(paths.dir, { recursive: true });

  if (await pathExists(paths.absolute)) {
    const existing = await readFile(paths.absolute, "utf8");
    if (existing === serialized) {
      return {
        status: "already_normalized",
        outputPathAbsolute: paths.absolute,
        outputPathRelative: paths.relative,
        document: input.document,
      };
    }
    throw new NormalizeError(
      "OUTPUT_CONFLICT",
      `Le fichier normalisé existe déjà avec un contenu différent : ${paths.relative}. Aucun écrasement effectué.`,
    );
  }

  try {
    await writeFile(paths.absolute, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (code === "EEXIST") {
      const existing = await readFile(paths.absolute, "utf8");
      if (existing === serialized) {
        return {
          status: "already_normalized",
          outputPathAbsolute: paths.absolute,
          outputPathRelative: paths.relative,
          document: input.document,
        };
      }
      throw new NormalizeError(
        "OUTPUT_CONFLICT",
        `Le fichier normalisé existe déjà avec un contenu différent : ${paths.relative}. Aucun écrasement effectué.`,
      );
    }
    throw error;
  }

  return {
    status: "written",
    outputPathAbsolute: paths.absolute,
    outputPathRelative: paths.relative,
    document: input.document,
  };
}

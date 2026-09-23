import type { PublishFs } from "../publish.js";
import {
  isPublishError,
  publishExclusiveTextFile,
} from "../publish.js";
import { NormalizeError } from "./errors.js";
import { assertSafeCollectionId, getProjectRoot } from "./load.js";
import {
  NORMALIZER_VERSION,
  type NormalizedArticleDocument,
} from "./types.js";
import { serializeNormalizedDocument } from "./build.js";
import path from "node:path";

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

/** Alias de compatibilité pour les tests de publication. */
export type NormalizedStoreFs = PublishFs;

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

function mapPublishError(error: unknown): never {
  if (isPublishError(error)) {
    throw new NormalizeError(error.code, error.message, error.exitCode);
  }
  throw error;
}

/**
 * Écrit le document normalisé via publication exclusive (temporaire + fs.link).
 */
export async function writeNormalizedDocument(input: {
  document: NormalizedArticleDocument;
  projectRoot?: string;
  fs?: Partial<NormalizedStoreFs>;
}): Promise<WriteNormalizedResult> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const serialized = serializeNormalizedDocument(input.document);
  const paths = resolveNormalizedOutputPath(
    input.document.provenance.collectionId,
    projectRoot,
  );

  let published;
  try {
    published = await publishExclusiveTextFile(
      input.fs !== undefined
        ? {
            content: serialized,
            destinationAbsolute: paths.absolute,
            destinationLabel: paths.relative,
            fs: input.fs,
          }
        : {
            content: serialized,
            destinationAbsolute: paths.absolute,
            destinationLabel: paths.relative,
          },
    );
  } catch (error) {
    mapPublishError(error);
  }

  if (published.status === "already_identical") {
    return {
      status: "already_normalized",
      outputPathAbsolute: paths.absolute,
      outputPathRelative: paths.relative,
      document: input.document,
    };
  }

  return {
    status: "written",
    outputPathAbsolute: paths.absolute,
    outputPathRelative: paths.relative,
    document: input.document,
  };
}

import { buildNormalizedArticleDocument } from "./build.js";
import { loadCollectionForNormalize } from "./load.js";
import { writeNormalizedDocument } from "./store.js";
import type { NormalizedArticleDocument } from "./types.js";
import type { WriteNormalizedResult } from "./store.js";

export type NormalizeCollectionResult = WriteNormalizedResult & {
  document: NormalizedArticleDocument;
};

/**
 * Normalise une collecte à partir de son fichier de métadonnées.
 * Aucun appel réseau ; ne modifie ni corps ni métadonnées de collecte.
 */
export async function normalizeCollection(input: {
  collectionMetaPath: string;
  /** Racine projet (tests) ; défaut : racine du dépôt. */
  projectRoot?: string;
}): Promise<NormalizeCollectionResult> {
  const loaded = await loadCollectionForNormalize(
    input.collectionMetaPath,
    input.projectRoot !== undefined
      ? { projectRoot: input.projectRoot }
      : {},
  );

  const document = buildNormalizedArticleDocument({
    article: loaded.article,
    provenance: {
      collectionId: loaded.metadata.collectionId,
      collectedAtUtc: loaded.metadata.collectedAtUtc,
      environment: loaded.metadata.environment,
      requestedArticleId: loaded.metadata.requestedArticleId,
      apiUrl: loaded.metadata.url,
      bodySha256: loaded.metadata.bodySha256,
      bodyPath: loaded.bodyPathRelative,
      collectionMetaPath: loaded.metadataPathRelative,
    },
  });

  const written = await writeNormalizedDocument(
    input.projectRoot !== undefined
      ? { document, projectRoot: input.projectRoot }
      : { document },
  );

  return written;
}

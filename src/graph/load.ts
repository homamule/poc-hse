import { readFile } from "node:fs/promises";
import path from "node:path";
import { getProjectRoot } from "../normalize/load.js";
import {
  NORMALIZER_SCHEMA_VERSION,
  type NormalizedArticleDocument,
} from "../normalize/types.js";
import {
  RELATION_INVENTORY_POLICY_VERSION,
  RELATION_INVENTORY_SCHEMA_VERSION,
  type RelationInventoryEntry,
  type RelationInventoryReport,
} from "../relations/types.js";
import { GraphError } from "./errors.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveUnderProject(
  projectRoot: string,
  relativeOrAbsolute: string,
  label: string,
): { absolute: string; relative: string } {
  const absolute = path.isAbsolute(relativeOrAbsolute)
    ? path.normalize(relativeOrAbsolute)
    : path.resolve(projectRoot, relativeOrAbsolute);
  const relative = toPosix(path.relative(projectRoot, absolute));
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative === ""
  ) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `Chemin hors projet ou invalide (${label}) : ${relativeOrAbsolute}`,
    );
  }
  return { absolute, relative };
}

function parseInventory(raw: unknown): RelationInventoryReport {
  if (!isPlainObject(raw)) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "Inventaire invalide : objet JSON attendu.",
    );
  }
  if (raw.schemaVersion !== RELATION_INVENTORY_SCHEMA_VERSION) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `schemaVersion d'inventaire invalide (attendu ${RELATION_INVENTORY_SCHEMA_VERSION}).`,
    );
  }
  if (raw.inventoryPolicyVersion !== RELATION_INVENTORY_POLICY_VERSION) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `inventoryPolicyVersion non supportée (attendu ${RELATION_INVENTORY_POLICY_VERSION}).`,
    );
  }
  if (typeof raw.inventoryId !== "string" || !raw.inventoryId.trim()) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "inventoryId manquant ou invalide.",
    );
  }
  if (!Array.isArray(raw.corpus) || raw.corpus.length === 0) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "corpus d'inventaire manquant ou vide.",
    );
  }
  if (!Array.isArray(raw.entries)) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "entries d'inventaire invalides.",
    );
  }
  if (
    !isPlainObject(raw.counters) ||
    !isPlainObject(raw.counters.byResolution)
  ) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "counters d'inventaire invalides.",
    );
  }
  return raw as unknown as RelationInventoryReport;
}

function assertCountersConsistent(inventory: RelationInventoryReport): void {
  const tallied = {
    version_collectee: 0,
    autre_version_connue: 0,
    non_resolue: 0,
  };
  for (const entry of inventory.entries) {
    const cls = entry.resolution?.class;
    if (
      cls !== "version_collectee" &&
      cls !== "autre_version_connue" &&
      cls !== "non_resolue"
    ) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        "Entrée d'inventaire avec classe de résolution invalide.",
      );
    }
    tallied[cls] += 1;
  }
  const declared = inventory.counters.byResolution;
  if (
    tallied.version_collectee !== declared.version_collectee ||
    tallied.autre_version_connue !== declared.autre_version_connue ||
    tallied.non_resolue !== declared.non_resolue ||
    inventory.entries.length !== inventory.counters.total
  ) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "Compteurs d'inventaire incohérents avec les entrées.",
    );
  }
}

export type LoadedNormalizedCorpusArticle = {
  collectionId: string;
  articleId: string;
  normalizedPathRelative: string;
  document: NormalizedArticleDocument;
};

export type LoadedInventoryForGraph = {
  inventory: RelationInventoryReport;
  inventoryPathRelative: string;
  inventoryPathAbsolute: string;
  normalizedArticles: LoadedNormalizedCorpusArticle[];
  /** identity.id des versions collectées. */
  collectedIds: Set<string>;
  /** ids confirmés via versions.articleVersions des fichiers normalisés. */
  confirmedVersionIds: Set<string>;
  projectedEntries: RelationInventoryEntry[];
};

function extractArticleVersionIds(
  document: NormalizedArticleDocument,
): string[] {
  const versions = document.versions.articleVersions;
  if (!Array.isArray(versions)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of versions) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { id?: unknown }).id === "string"
    ) {
      const id = (entry as { id: string }).id;
      if (id.length > 0) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Charge l'inventaire et les documents normalisés du corpus pour confirmation.
 */
export async function loadInventoryForGraph(input: {
  inventoryPath: string;
  projectRoot?: string;
}): Promise<LoadedInventoryForGraph> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const inventoryResolved = resolveUnderProject(
    projectRoot,
    input.inventoryPath,
    "inventory",
  );

  let raw: unknown;
  try {
    const text = await readFile(inventoryResolved.absolute, "utf8");
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof GraphError) throw error;
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `Impossible de lire l'inventaire : ${inventoryResolved.relative}`,
    );
  }

  const inventory = parseInventory(raw);
  assertCountersConsistent(inventory);

  const collectedIds = new Set<string>();
  const confirmedVersionIds = new Set<string>();
  const normalizedArticles: LoadedNormalizedCorpusArticle[] = [];

  for (const item of inventory.corpus) {
    if (
      typeof item.collectionId !== "string" ||
      typeof item.articleId !== "string" ||
      typeof item.normalizedPath !== "string" ||
      typeof item.bodySha256 !== "string"
    ) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        "Empreinte de corpus d'inventaire invalide.",
      );
    }

    const normResolved = resolveUnderProject(
      projectRoot,
      item.normalizedPath,
      `corpus ${item.collectionId}`,
    );

    let document: NormalizedArticleDocument;
    try {
      const text = await readFile(normResolved.absolute, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isPlainObject(parsed)) {
        throw new GraphError(
          "GRAPH_INPUT_INVALID",
          `Document normalisé invalide : ${normResolved.relative}`,
        );
      }
      document = parsed as unknown as NormalizedArticleDocument;
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Impossible de lire le document normalisé : ${normResolved.relative}`,
      );
    }

    if (document.schemaVersion !== NORMALIZER_SCHEMA_VERSION) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `schemaVersion incohérent dans ${normResolved.relative}.`,
      );
    }
    if (document.provenance.collectionId !== item.collectionId) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `provenance.collectionId incohérent dans ${normResolved.relative}.`,
      );
    }
    if (document.identity.id !== item.articleId) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `identity.id incohérent dans ${normResolved.relative} (${document.identity.id} vs ${item.articleId}).`,
      );
    }
    if (document.provenance.bodySha256 !== item.bodySha256) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `bodySha256 incohérent dans ${normResolved.relative}.`,
      );
    }

    collectedIds.add(item.articleId);
    for (const versionId of extractArticleVersionIds(document)) {
      confirmedVersionIds.add(versionId);
    }

    normalizedArticles.push({
      collectionId: item.collectionId,
      articleId: item.articleId,
      normalizedPathRelative: normResolved.relative,
      document,
    });
  }

  const projectedEntries = inventory.entries.filter(
    (e) =>
      e.resolution.class === "version_collectee" ||
      e.resolution.class === "autre_version_connue",
  );

  return {
    inventory,
    inventoryPathRelative: inventoryResolved.relative,
    inventoryPathAbsolute: inventoryResolved.absolute,
    normalizedArticles,
    collectedIds,
    confirmedVersionIds,
    projectedEntries,
  };
}

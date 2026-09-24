import { createHash } from "node:crypto";
import { canonicalize, stableStringify } from "../compare/canonicalize.js";
import type { RelationInventoryEntry } from "../relations/types.js";
import type { LoadedInventoryForGraph } from "./load.js";
import { GraphError } from "./errors.js";
import {
  GRAPH_POLICY_VERSION,
  GRAPH_SCHEMA_VERSION,
  type ArticleVersionNode,
  type CollectedArticleVersionNode,
  type GraphDocument,
  type GraphLink,
  type HistoricalArticleVersionNode,
  type RelationSourceNode,
} from "./types.js";

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildRelationSourceId(input: {
  inventoryId: string;
  sourceCollectionId: string;
  family: string;
  index: number;
}): string {
  const payload = canonicalize({
    inventoryId: input.inventoryId,
    sourceCollectionId: input.sourceCollectionId,
    family: input.family,
    index: input.index,
  });
  const digest = createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
  return `RelationSource:${digest}`;
}

export function buildGraphId(input: {
  inventoryId: string;
  collectedIds: string[];
  historicalIds: string[];
  relationSourceIds: string[];
}): string {
  const payload = canonicalize({
    graphPolicyVersion: GRAPH_POLICY_VERSION,
    inventoryId: input.inventoryId,
    collectedIds: [...input.collectedIds].sort(compareStrings),
    historicalIds: [...input.historicalIds].sort(compareStrings),
    relationSourceIds: [...input.relationSourceIds].sort(compareStrings),
  });
  return createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

function assertProjectedEntry(
  entry: RelationInventoryEntry,
  loaded: LoadedInventoryForGraph,
): asserts entry is RelationInventoryEntry & {
  articleId: string;
  resolution: {
    class: "version_collectee" | "autre_version_connue";
  };
} {
  const cls = entry.resolution.class;
  if (cls !== "version_collectee" && cls !== "autre_version_connue") {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      "Entrée projetée avec classe inattendue.",
    );
  }
  if (typeof entry.articleId !== "string" || entry.articleId.length === 0) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `Entrée projetée sans articleId référencé (${entry.source.collectionId}/${entry.family}#${entry.index}).`,
    );
  }

  if (!loaded.collectedIds.has(entry.source.articleId)) {
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `Source d'entrée hors corpus collecté : ${entry.source.articleId}.`,
    );
  }

  if (cls === "version_collectee") {
    if (!loaded.collectedIds.has(entry.articleId)) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Cible version_collectee non collectée : ${entry.articleId}.`,
      );
    }
    if (
      entry.resolution.matchedCollectionId !== undefined &&
      !loaded.normalizedArticles.some(
        (a) => a.collectionId === entry.resolution.matchedCollectionId,
      )
    ) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `matchedCollectionId incohérent pour ${entry.articleId}.`,
      );
    }
  } else {
    // autre_version_connue : confirmée via articleVersions, jamais fusionnée avec une collectée
    if (loaded.collectedIds.has(entry.articleId)) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Cible classée autre_version_connue mais aussi collectée : ${entry.articleId}.`,
      );
    }
    if (!loaded.confirmedVersionIds.has(entry.articleId)) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Cible historique non confirmée dans articleVersions : ${entry.articleId}.`,
      );
    }
  }
}

function buildCollectedNodes(
  loaded: LoadedInventoryForGraph,
): CollectedArticleVersionNode[] {
  const nodes: CollectedArticleVersionNode[] = loaded.normalizedArticles.map(
    (article) => ({
      kind: "ArticleVersion" as const,
      id: article.document.identity.id as string,
      collected: true as const,
      num: article.document.identity.num,
      cid: article.document.identity.cid,
      etat: article.document.identity.etat,
      collectionId: article.document.provenance.collectionId,
      bodySha256: article.document.provenance.bodySha256,
      normalizedPath: article.normalizedPathRelative,
    }),
  );
  nodes.sort((a, b) => compareStrings(a.id, b.id));
  return nodes;
}

function buildHistoricalNodes(
  projectedEntries: Array<RelationInventoryEntry & { articleId: string }>,
  collectedIds: Set<string>,
): HistoricalArticleVersionNode[] {
  const byId = new Map<string, HistoricalArticleVersionNode>();

  for (const entry of projectedEntries) {
    if (entry.resolution.class !== "autre_version_connue") {
      continue;
    }
    if (collectedIds.has(entry.articleId)) {
      continue;
    }
    const existing = byId.get(entry.articleId);
    const articleNum =
      typeof entry.articleNum === "string" ? entry.articleNum : null;
    if (existing === undefined) {
      byId.set(entry.articleId, {
        kind: "ArticleVersion",
        id: entry.articleId,
        collected: false,
        articleNum,
      });
    } else if (
      existing.articleNum === null &&
      articleNum !== null &&
      articleNum.length > 0
    ) {
      existing.articleNum = articleNum;
    }
  }

  return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
}

/**
 * Construit le graphe JSON déterministe (projection locale, sans Neo4j).
 */
export function buildGraphDocument(
  loaded: LoadedInventoryForGraph,
): GraphDocument {
  for (const entry of loaded.projectedEntries) {
    assertProjectedEntry(entry, loaded);
  }

  const projected = loaded.projectedEntries as Array<
    RelationInventoryEntry & {
      articleId: string;
      resolution: {
        class: "version_collectee" | "autre_version_connue";
      };
    }
  >;

  const collectedNodes = buildCollectedNodes(loaded);
  const historicalNodes = buildHistoricalNodes(
    projected,
    loaded.collectedIds,
  );
  const articleVersions: ArticleVersionNode[] = [
    ...collectedNodes,
    ...historicalNodes,
  ];

  const articleIds = new Set(articleVersions.map((n) => n.id));

  const relationSources: RelationSourceNode[] = [];
  const links: GraphLink[] = [];

  for (const entry of projected) {
    // L'identifiant du nœud référencé doit être exactement celui de l'entrée.
    if (!articleIds.has(entry.articleId)) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Nœud ArticleVersion manquant pour la cible ${entry.articleId}.`,
      );
    }
    if (!articleIds.has(entry.source.articleId)) {
      throw new GraphError(
        "GRAPH_INPUT_INVALID",
        `Nœud ArticleVersion manquant pour la source ${entry.source.articleId}.`,
      );
    }

    const relationSourceId = buildRelationSourceId({
      inventoryId: loaded.inventory.inventoryId,
      sourceCollectionId: entry.source.collectionId,
      family: entry.family,
      index: entry.index,
    });

    relationSources.push({
      kind: "RelationSource",
      id: relationSourceId,
      inventoryId: loaded.inventory.inventoryId,
      sourceCollectionId: entry.source.collectionId,
      family: entry.family,
      index: entry.index,
      linkType: entry.linkType,
      linkOrientation: entry.linkOrientation,
      resolutionClass: entry.resolution.class,
      referencedArticleId: entry.articleId,
      pointer: {
        normalizedPath: entry.pointer.normalizedPath,
        family: entry.pointer.family,
        index: entry.pointer.index,
      },
    });

    links.push({
      type: "OBSERVATION_DANS",
      from: entry.source.articleId,
      to: relationSourceId,
    });
    links.push({
      type: "REFERENCE_IDENTIFIANT",
      from: relationSourceId,
      to: entry.articleId,
    });
  }

  relationSources.sort((a, b) => compareStrings(a.id, b.id));
  links.sort((a, b) => {
    const t = compareStrings(a.type, b.type);
    if (t !== 0) return t;
    const f = compareStrings(a.from, b.from);
    if (f !== 0) return f;
    return compareStrings(a.to, b.to);
  });

  const graphId = buildGraphId({
    inventoryId: loaded.inventory.inventoryId,
    collectedIds: collectedNodes.map((n) => n.id),
    historicalIds: historicalNodes.map((n) => n.id),
    relationSourceIds: relationSources.map((n) => n.id),
  });

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    graphPolicyVersion: GRAPH_POLICY_VERSION,
    graphId,
    inventoryId: loaded.inventory.inventoryId,
    inventoryPath: loaded.inventoryPathRelative,
    metadata: {
      articleVersionsCollected: collectedNodes.length,
      articleVersionsHistorical: historicalNodes.length,
      relationSources: relationSources.length,
      links: links.length,
      nonResolueCount: loaded.inventory.counters.byResolution.non_resolue,
      projectedEntryCount: projected.length,
    },
    nodes: {
      articleVersions,
      relationSources,
    },
    links,
  };
}

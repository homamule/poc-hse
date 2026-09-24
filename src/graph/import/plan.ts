import type { GraphDocument } from "../types.js";

export const HSE_ARTICLE_VERSION_LABEL = "HseArticleVersion" as const;
export const HSE_RELATION_SOURCE_LABEL = "HseRelationSource" as const;

export const CONSTRAINT_ARTICLE_VERSION =
  "hse_article_version_key" as const;
export const CONSTRAINT_RELATION_SOURCE =
  "hse_relation_source_key" as const;

export function nodeKey(graphId: string, nodeId: string): string {
  return `${graphId}:${nodeId}`;
}

export type ArticleVersionImportProps = {
  key: string;
  graphId: string;
  id: string;
  collected: boolean;
  num?: string | null;
  cid?: string | null;
  etat?: string | null;
  collectionId?: string;
  bodySha256?: string;
  normalizedPath?: string;
  articleNum?: string | null;
};

export type RelationSourceImportProps = {
  key: string;
  graphId: string;
  id: string;
  inventoryId: string;
  sourceCollectionId: string;
  family: string;
  index: number;
  linkType: string | null;
  linkOrientation: string | null;
  resolutionClass: string;
  referencedArticleId: string;
  pointerNormalizedPath: string;
  pointerFamily: string;
  pointerIndex: number;
};

export type LinkImportSpec = {
  type: "OBSERVATION_DANS" | "REFERENCE_IDENTIFIANT";
  fromKey: string;
  toKey: string;
  fromLabel: typeof HSE_ARTICLE_VERSION_LABEL | typeof HSE_RELATION_SOURCE_LABEL;
  toLabel: typeof HSE_ARTICLE_VERSION_LABEL | typeof HSE_RELATION_SOURCE_LABEL;
  graphId: string;
};

export type GraphImportPlan = {
  graphId: string;
  inventoryId: string;
  articleVersions: ArticleVersionImportProps[];
  relationSources: RelationSourceImportProps[];
  links: LinkImportSpec[];
  expectedCounts: {
    collected: number;
    historical: number;
    relationSources: number;
    links: number;
  };
};

function scalarString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * Plan d'import déterministe dérivé du graphe validé.
 * Les clés Neo4j sont "<graphId>:<id JSON>".
 */
export function buildImportPlan(graph: GraphDocument): GraphImportPlan {
  const graphId = graph.graphId;

  const articleVersions: ArticleVersionImportProps[] = graph.nodes.articleVersions.map(
    (node) => {
      const base = {
        key: nodeKey(graphId, node.id),
        graphId,
        id: node.id,
        collected: node.collected,
      };
      if (node.collected) {
        return {
          ...base,
          num: node.num,
          cid: node.cid,
          etat: node.etat,
          collectionId: node.collectionId,
          bodySha256: node.bodySha256,
          normalizedPath: node.normalizedPath,
        };
      }
      return {
        ...base,
        articleNum: node.articleNum,
      };
    },
  );

  const relationSources: RelationSourceImportProps[] =
    graph.nodes.relationSources.map((node) => ({
      key: nodeKey(graphId, node.id),
      graphId,
      id: node.id,
      inventoryId: node.inventoryId,
      sourceCollectionId: node.sourceCollectionId,
      family: node.family,
      index: node.index,
      linkType: scalarString(node.linkType),
      linkOrientation: scalarString(node.linkOrientation),
      resolutionClass: node.resolutionClass,
      referencedArticleId: node.referencedArticleId,
      pointerNormalizedPath: node.pointer.normalizedPath,
      pointerFamily: node.pointer.family,
      pointerIndex: node.pointer.index,
    }));

  const articleIdSet = new Set(graph.nodes.articleVersions.map((n) => n.id));
  const relationIdSet = new Set(graph.nodes.relationSources.map((n) => n.id));

  const links: LinkImportSpec[] = graph.links.map((link) => {
    if (link.type === "OBSERVATION_DANS") {
      if (!articleIdSet.has(link.from) || !relationIdSet.has(link.to)) {
        throw new Error("Plan d'import incohérent (OBSERVATION_DANS).");
      }
      return {
        type: "OBSERVATION_DANS" as const,
        fromKey: nodeKey(graphId, link.from),
        toKey: nodeKey(graphId, link.to),
        fromLabel: HSE_ARTICLE_VERSION_LABEL,
        toLabel: HSE_RELATION_SOURCE_LABEL,
        graphId,
      };
    }
    if (!relationIdSet.has(link.from) || !articleIdSet.has(link.to)) {
      throw new Error("Plan d'import incohérent (REFERENCE_IDENTIFIANT).");
    }
    return {
      type: "REFERENCE_IDENTIFIANT" as const,
      fromKey: nodeKey(graphId, link.from),
      toKey: nodeKey(graphId, link.to),
      fromLabel: HSE_RELATION_SOURCE_LABEL,
      toLabel: HSE_ARTICLE_VERSION_LABEL,
      graphId,
    };
  });

  return {
    graphId,
    inventoryId: graph.inventoryId,
    articleVersions,
    relationSources,
    links,
    expectedCounts: {
      collected: graph.metadata.articleVersionsCollected,
      historical: graph.metadata.articleVersionsHistorical,
      relationSources: graph.metadata.relationSources,
      links: graph.metadata.links,
    },
  };
}

export type ImportPreview = {
  mode: "preview";
  graphId: string;
  inventoryId: string;
  graphPath: string;
  nodeCounts: {
    articleVersionsCollected: number;
    articleVersionsHistorical: number;
    relationSources: number;
    totalNodes: number;
  };
  linkCounts: {
    OBSERVATION_DANS: number;
    REFERENCE_IDENTIFIANT: number;
    total: number;
  };
  nonResolueCount: number;
  sampleKeys: {
    articleVersions: string[];
    relationSources: string[];
  };
  neo4jLabels: {
    articleVersion: typeof HSE_ARTICLE_VERSION_LABEL;
    relationSource: typeof HSE_RELATION_SOURCE_LABEL;
  };
  note: string;
};

export function buildImportPreview(input: {
  graph: GraphDocument;
  graphPath: string;
  plan: GraphImportPlan;
}): ImportPreview {
  const { graph, plan } = input;
  return {
    mode: "preview",
    graphId: graph.graphId,
    inventoryId: graph.inventoryId,
    graphPath: input.graphPath,
    nodeCounts: {
      articleVersionsCollected: graph.metadata.articleVersionsCollected,
      articleVersionsHistorical: graph.metadata.articleVersionsHistorical,
      relationSources: graph.metadata.relationSources,
      totalNodes:
        graph.metadata.articleVersionsCollected +
        graph.metadata.articleVersionsHistorical +
        graph.metadata.relationSources,
    },
    linkCounts: {
      OBSERVATION_DANS: plan.links.filter((l) => l.type === "OBSERVATION_DANS")
        .length,
      REFERENCE_IDENTIFIANT: plan.links.filter(
        (l) => l.type === "REFERENCE_IDENTIFIANT",
      ).length,
      total: plan.links.length,
    },
    nonResolueCount: graph.metadata.nonResolueCount,
    sampleKeys: {
      articleVersions: plan.articleVersions.map((n) => n.key),
      relationSources: plan.relationSources.map((n) => n.key),
    },
    neo4jLabels: {
      articleVersion: HSE_ARTICLE_VERSION_LABEL,
      relationSource: HSE_RELATION_SOURCE_LABEL,
    },
    note: "Aperçu local uniquement — aucune connexion Neo4j, aucun identifiant lu.",
  };
}

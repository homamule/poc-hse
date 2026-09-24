import { readFile } from "node:fs/promises";
import path from "node:path";
import { getProjectRoot } from "../../normalize/load.js";
import { RELATION_FAMILIES } from "../../relations/types.js";
import { GraphError } from "../errors.js";
import {
  GRAPH_POLICY_VERSION,
  GRAPH_SCHEMA_VERSION,
  type ArticleVersionNode,
  type GraphDocument,
  type GraphLink,
  type RelationSourceNode,
} from "../types.js";

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

function fail(message: string): never {
  throw new GraphError("GRAPH_INPUT_INVALID", message);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} manquant ou invalide.`);
  }
  return value;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} doit être un booléen.`);
  }
  return value;
}

function assertNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  fail(`${label} doit être une chaîne ou null.`);
}

const COLLECTED_ONLY_KEYS = [
  "num",
  "cid",
  "etat",
  "collectionId",
  "bodySha256",
  "normalizedPath",
] as const;

function parseArticleVersion(raw: unknown, index: number): ArticleVersionNode {
  if (!isPlainObject(raw)) {
    fail(`nodes.articleVersions[${index}] invalide.`);
  }
  if (raw.kind !== "ArticleVersion") {
    fail(`nodes.articleVersions[${index}].kind invalide (ArticleVersion attendu).`);
  }
  const id = assertString(raw.id, `nodes.articleVersions[${index}].id`);
  const collected = assertBoolean(
    raw.collected,
    `nodes.articleVersions[${index}].collected`,
  );

  if (collected) {
    for (const key of COLLECTED_ONLY_KEYS) {
      if (!(key in raw)) {
        fail(
          `Version collectée ${id} : propriété manquante « ${key} ».`,
        );
      }
    }
    return {
      kind: "ArticleVersion",
      id,
      collected: true,
      num: assertNullableString(raw.num, `articleVersions[${index}].num`),
      cid: assertNullableString(raw.cid, `articleVersions[${index}].cid`),
      etat: assertNullableString(raw.etat, `articleVersions[${index}].etat`),
      collectionId: assertString(
        raw.collectionId,
        `articleVersions[${index}].collectionId`,
      ),
      bodySha256: assertString(
        raw.bodySha256,
        `articleVersions[${index}].bodySha256`,
      ),
      normalizedPath: assertString(
        raw.normalizedPath,
        `articleVersions[${index}].normalizedPath`,
      ),
    };
  }

  // Historique : ne doit pas présenter de contenu collecté
  for (const key of COLLECTED_ONLY_KEYS) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) {
      // normalizedPath/collectionId etc. must be absent for historical
      fail(
        `Version historique ${id} : propriété collectée interdite « ${key} ».`,
      );
    }
  }
  if ("etat" in raw && raw.etat !== undefined) {
    fail(`Version historique ${id} : état présenté alors que collected=false.`);
  }

  return {
    kind: "ArticleVersion",
    id,
    collected: false,
    articleNum: assertNullableString(
      raw.articleNum ?? null,
      `articleVersions[${index}].articleNum`,
    ),
  };
}

function parseRelationSource(raw: unknown, index: number): RelationSourceNode {
  if (!isPlainObject(raw)) {
    fail(`nodes.relationSources[${index}] invalide.`);
  }
  if (raw.kind !== "RelationSource") {
    fail(`nodes.relationSources[${index}].kind invalide (RelationSource attendu).`);
  }
  if (!isPlainObject(raw.pointer)) {
    fail(`nodes.relationSources[${index}].pointer invalide.`);
  }
  const resolutionClass = raw.resolutionClass;
  if (
    resolutionClass !== "version_collectee" &&
    resolutionClass !== "autre_version_connue"
  ) {
    fail(
      `nodes.relationSources[${index}].resolutionClass invalide.`,
    );
  }
  if (
    typeof raw.family !== "string" ||
    !(RELATION_FAMILIES as readonly string[]).includes(raw.family)
  ) {
    fail(`nodes.relationSources[${index}].family invalide.`);
  }
  if (typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0) {
    fail(`nodes.relationSources[${index}].index invalide.`);
  }
  if (
    typeof raw.pointer.family !== "string" ||
    !(RELATION_FAMILIES as readonly string[]).includes(raw.pointer.family)
  ) {
    fail(`nodes.relationSources[${index}].pointer.family invalide.`);
  }
  if (
    typeof raw.pointer.index !== "number" ||
    !Number.isInteger(raw.pointer.index) ||
    raw.pointer.index < 0
  ) {
    fail(`nodes.relationSources[${index}].pointer.index invalide.`);
  }

  return {
    kind: "RelationSource",
    id: assertString(raw.id, `relationSources[${index}].id`),
    inventoryId: assertString(
      raw.inventoryId,
      `relationSources[${index}].inventoryId`,
    ),
    sourceCollectionId: assertString(
      raw.sourceCollectionId,
      `relationSources[${index}].sourceCollectionId`,
    ),
    family: raw.family as RelationSourceNode["family"],
    index: raw.index,
    linkType: raw.linkType,
    linkOrientation: raw.linkOrientation,
    resolutionClass,
    referencedArticleId: assertString(
      raw.referencedArticleId,
      `relationSources[${index}].referencedArticleId`,
    ),
    pointer: {
      normalizedPath: assertString(
        raw.pointer.normalizedPath,
        `relationSources[${index}].pointer.normalizedPath`,
      ),
      family: raw.pointer.family as RelationSourceNode["pointer"]["family"],
      index: raw.pointer.index,
    },
  };
}

function parseLink(raw: unknown, index: number): GraphLink {
  if (!isPlainObject(raw)) {
    fail(`links[${index}] invalide.`);
  }
  if (raw.type !== "OBSERVATION_DANS" && raw.type !== "REFERENCE_IDENTIFIANT") {
    fail(
      `links[${index}].type invalide (OBSERVATION_DANS ou REFERENCE_IDENTIFIANT attendu).`,
    );
  }
  return {
    type: raw.type,
    from: assertString(raw.from, `links[${index}].from`),
    to: assertString(raw.to, `links[${index}].to`),
  };
}

/**
 * Valide intégralement un document graphe avant tout aperçu ou import.
 * Rejette le fichier entier à la première incohérence.
 */
export function validateGraphDocument(raw: unknown): GraphDocument {
  if (!isPlainObject(raw)) {
    fail("Graphe invalide : objet JSON attendu.");
  }
  if (raw.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    fail(
      `schemaVersion invalide (attendu ${GRAPH_SCHEMA_VERSION}).`,
    );
  }
  if (raw.graphPolicyVersion !== GRAPH_POLICY_VERSION) {
    fail(
      `graphPolicyVersion non supportée (attendu ${GRAPH_POLICY_VERSION}).`,
    );
  }
  const graphId = assertString(raw.graphId, "graphId");
  const inventoryId = assertString(raw.inventoryId, "inventoryId");
  const inventoryPath = assertString(raw.inventoryPath, "inventoryPath");

  if (!isPlainObject(raw.metadata)) {
    fail("metadata manquante.");
  }
  if (!isPlainObject(raw.nodes)) {
    fail("nodes manquant.");
  }
  if (!Array.isArray(raw.nodes.articleVersions)) {
    fail("nodes.articleVersions doit être un tableau.");
  }
  if (!Array.isArray(raw.nodes.relationSources)) {
    fail("nodes.relationSources doit être un tableau.");
  }
  if (!Array.isArray(raw.links)) {
    fail("links doit être un tableau.");
  }

  const articleVersions = raw.nodes.articleVersions.map(parseArticleVersion);
  const relationSources = raw.nodes.relationSources.map(parseRelationSource);
  const links = raw.links.map(parseLink);

  const collectedCount = articleVersions.filter((n) => n.collected).length;
  const historicalCount = articleVersions.filter((n) => !n.collected).length;

  if (collectedCount !== raw.metadata.articleVersionsCollected) {
    fail("Compteur articleVersionsCollected incohérent.");
  }
  if (historicalCount !== raw.metadata.articleVersionsHistorical) {
    fail("Compteur articleVersionsHistorical incohérent.");
  }
  if (relationSources.length !== raw.metadata.relationSources) {
    fail("Compteur relationSources incohérent.");
  }
  if (links.length !== raw.metadata.links) {
    fail("Compteur links incohérent.");
  }
  if (typeof raw.metadata.nonResolueCount !== "number") {
    fail("metadata.nonResolueCount manquant.");
  }
  if (typeof raw.metadata.projectedEntryCount !== "number") {
    fail("metadata.projectedEntryCount manquant.");
  }
  if (raw.metadata.projectedEntryCount !== relationSources.length) {
    fail("projectedEntryCount incohérent avec RelationSource.");
  }

  const articleIds = new Set<string>();
  for (const node of articleVersions) {
    if (articleIds.has(node.id)) {
      fail(`Identifiant ArticleVersion dupliqué : ${node.id}.`);
    }
    articleIds.add(node.id);
  }

  const relationIds = new Set<string>();
  for (const node of relationSources) {
    if (relationIds.has(node.id)) {
      fail(`Identifiant RelationSource dupliqué : ${node.id}.`);
    }
    if (articleIds.has(node.id)) {
      fail(`Collision d'identifiants entre kinds : ${node.id}.`);
    }
    relationIds.add(node.id);
    if (node.inventoryId !== inventoryId) {
      fail(`RelationSource ${node.id} : inventoryId incohérent.`);
    }
  }

  const allNodeIds = new Set([...articleIds, ...relationIds]);
  const articleById = new Map(articleVersions.map((n) => [n.id, n]));

  for (const link of links) {
    if (!allNodeIds.has(link.from) || !allNodeIds.has(link.to)) {
      fail(
        `Lien ${link.type} vers un nœud inexistant (${link.from} → ${link.to}).`,
      );
    }
  }

  // Cohérence RelationSource ↔ deux liens techniques
  for (const rs of relationSources) {
    const observations = links.filter(
      (l) => l.type === "OBSERVATION_DANS" && l.to === rs.id,
    );
    const references = links.filter(
      (l) => l.type === "REFERENCE_IDENTIFIANT" && l.from === rs.id,
    );

    if (observations.length !== 1) {
      fail(
        `RelationSource ${rs.id} : exactement un lien OBSERVATION_DANS entrant attendu.`,
      );
    }
    if (references.length !== 1) {
      fail(
        `RelationSource ${rs.id} : exactement un lien REFERENCE_IDENTIFIANT sortant attendu.`,
      );
    }

    const observation = observations[0]!;
    const reference = references[0]!;
    const sourceArticle = articleById.get(observation.from);
    if (!sourceArticle || !sourceArticle.collected) {
      fail(
        `RelationSource ${rs.id} : OBSERVATION_DANS doit partir d'une ArticleVersion collectée.`,
      );
    }
    if (sourceArticle.collectionId !== rs.sourceCollectionId) {
      fail(
        `RelationSource ${rs.id} : sourceCollectionId incohérent avec l'ArticleVersion source.`,
      );
    }
    if (reference.to !== rs.referencedArticleId) {
      fail(
        `RelationSource ${rs.id} : REFERENCE_IDENTIFIANT ne cible pas referencedArticleId.`,
      );
    }
    if (!articleById.has(reference.to)) {
      fail(
        `RelationSource ${rs.id} : cible REFERENCE_IDENTIFIANT absente.`,
      );
    }
  }

  // Aucun autre lien que ceux attachés aux RelationSource (déjà comptés)
  const expectedLinkCount = relationSources.length * 2;
  if (links.length !== expectedLinkCount) {
    fail(
      `Nombre de liens incohérent avec les RelationSource (${links.length} vs ${expectedLinkCount}).`,
    );
  }

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    graphPolicyVersion: GRAPH_POLICY_VERSION,
    graphId,
    inventoryId,
    inventoryPath,
    metadata: {
      articleVersionsCollected: collectedCount,
      articleVersionsHistorical: historicalCount,
      relationSources: relationSources.length,
      links: links.length,
      nonResolueCount: raw.metadata.nonResolueCount,
      projectedEntryCount: raw.metadata.projectedEntryCount,
    },
    nodes: { articleVersions, relationSources },
    links,
  };
}

export async function loadAndValidateGraph(input: {
  graphPath: string;
  projectRoot?: string;
}): Promise<{
  graph: GraphDocument;
  graphPathRelative: string;
  graphPathAbsolute: string;
}> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const resolved = resolveUnderProject(projectRoot, input.graphPath, "graph");

  let raw: unknown;
  try {
    const text = await readFile(resolved.absolute, "utf8");
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof GraphError) throw error;
    throw new GraphError(
      "GRAPH_INPUT_INVALID",
      `Impossible de lire le graphe : ${resolved.relative}`,
    );
  }

  return {
    graph: validateGraphDocument(raw),
    graphPathRelative: resolved.relative,
    graphPathAbsolute: resolved.absolute,
  };
}

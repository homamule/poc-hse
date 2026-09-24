import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import neo4j, { type Driver } from "neo4j-driver";
import { getProjectRoot } from "../../normalize/load.js";
import { NORMALIZER_SCHEMA_VERSION } from "../../normalize/types.js";
import { GraphError } from "../errors.js";
import { loadNeo4jImportConfig, safeNeo4jEndpointSummary, type Neo4jImportConfig } from "../import/config.js";
import { nodeKey } from "../import/plan.js";
import { loadAndValidateGraph } from "../import/validate.js";

export type ArticleContent = {
  key: string;
  id: string;
  num: string | null;
  collectionId: string;
  bodySha256: string;
  normalizedPath: string;
  texte: string;
  texteSha256: string;
  texteSource: "content.texte";
};

export type ContentDriver = {
  apply(graphId: string, articles: ArticleContent[]): Promise<{ written: number; alreadyPresent: number }>;
  close(): Promise<void>;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadContent(projectRoot: string, graphId: string, node: {
  id: string; num: string | null; collectionId: string; bodySha256: string; normalizedPath: string;
}): Promise<ArticleContent> {
  const absolute = path.resolve(projectRoot, node.normalizedPath);
  const relative = path.relative(projectRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GraphError("GRAPH_INPUT_INVALID", `Chemin normalisé hors projet : ${node.id}.`);
  }
  let parsed: unknown;
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(projectRoot), realpath(absolute)]);
    const actualRelative = path.relative(rootReal, fileReal);
    if (actualRelative === "" || actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
      throw new GraphError("GRAPH_INPUT_INVALID", `Chemin normalisé hors projet : ${node.id}.`);
    }
    parsed = JSON.parse(await readFile(fileReal, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof GraphError) throw error;
    throw new GraphError("GRAPH_INPUT_INVALID", `Document normalisé illisible : ${node.id}.`);
  }
  if (!object(parsed) || parsed.schemaVersion !== NORMALIZER_SCHEMA_VERSION ||
      !object(parsed.identity) || !object(parsed.provenance) || !object(parsed.content) ||
      parsed.identity.id !== node.id ||
      parsed.provenance.collectionId !== node.collectionId ||
      parsed.provenance.bodySha256 !== node.bodySha256) {
    throw new GraphError("GRAPH_INPUT_INVALID", `Provenance du texte incohérente : ${node.id}.`);
  }
  const texte = parsed.content.texte;
  if (typeof texte !== "string" || texte.trim() === "") {
    throw new GraphError("GRAPH_INPUT_INVALID", `Texte source absent ou vide : ${node.id}.`);
  }
  return {
    key: nodeKey(graphId, node.id), id: node.id, num: node.num,
    collectionId: node.collectionId, bodySha256: node.bodySha256,
    normalizedPath: node.normalizedPath, texte,
    texteSha256: createHash("sha256").update(texte, "utf8").digest("hex"),
    texteSource: "content.texte",
  };
}

const contentFields = ["texte", "texteSha256", "texteSource"] as const;

/** Compare all fields before any write. A partly populated node is a conflict. */
export function classifyExisting(props: Record<string, unknown>, article: ArticleContent): "write" | "already_present" {
  if (props.key !== article.key || props.id !== article.id || props.graphId !== article.key.split(":")[0] ||
      props.collected !== true || props.collectionId !== article.collectionId ||
      props.bodySha256 !== article.bodySha256 || props.normalizedPath !== article.normalizedPath) {
    throw new GraphError("GRAPH_CONTENT_CONFLICT", `Nœud collecté incohérent : ${article.id}.`);
  }
  const present = contentFields.filter((field) => Object.hasOwn(props, field));
  if (present.length === 0) return "write";
  if (present.length !== contentFields.length || contentFields.some((field) => props[field] !== article[field])) {
    throw new GraphError("GRAPH_CONTENT_CONFLICT", `Texte déjà présent avec des valeurs différentes : ${article.id}.`);
  }
  return "already_present";
}

export function createContentDriver(config: Neo4jImportConfig): ContentDriver {
  const driver: Driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
  return {
    async apply(graphId, articles) {
      const session = driver.session({ database: config.database });
      try {
        return await session.executeWrite(async (tx) => {
          const keys = articles.map((a) => a.key);
          const existing = await tx.run(
            "MATCH (n:HseArticleVersion) WHERE n.key IN $keys RETURN properties(n) AS props",
            { keys },
          );
          if (existing.records.length !== articles.length) {
            throw new GraphError("GRAPH_CONTENT_MISSING", "Nombre de nœuds collectés inattendu : importer d'abord le graphe correspondant.");
          }
          const byKey = new Map<string, Record<string, unknown>>();
          for (const record of existing.records) {
            const props = record.get("props") as Record<string, unknown>;
            if (typeof props.key !== "string" || byKey.has(props.key)) {
              throw new GraphError("GRAPH_CONTENT_CONFLICT", "Clés Neo4j inattendues.");
            }
            byKey.set(props.key, props);
          }
          const pending: ArticleContent[] = [];
          for (const article of articles) {
            const props = byKey.get(article.key);
            if (!props) throw new GraphError("GRAPH_CONTENT_MISSING", `Nœud absent : ${article.id}.`);
            if (props.graphId !== graphId) throw new GraphError("GRAPH_CONTENT_CONFLICT", `graphId incohérent : ${article.id}.`);
            if (classifyExisting(props, article) === "write") pending.push(article);
          }
          for (const article of pending) {
            const result = await tx.run(
              "MATCH (n:HseArticleVersion {key: $key, graphId: $graphId, collected: true}) " +
              "SET n.texte = $texte, n.texteSha256 = $texteSha256, n.texteSource = $texteSource " +
              "RETURN count(n) AS count",
              { key: article.key, graphId, texte: article.texte,
                texteSha256: article.texteSha256, texteSource: article.texteSource },
            );
            if (Number(result.records[0]?.get("count")) !== 1) {
              throw new GraphError("GRAPH_CONTENT_MISSING", `Nœud absent pendant l'écriture : ${article.id}.`);
            }
          }
          return { written: pending.length, alreadyPresent: articles.length - pending.length };
        });
      } catch (error) {
        if (error instanceof GraphError) throw error;
        throw new GraphError("GRAPH_NEO4J", "Échec de l'enrichissement Neo4j (détails non exposés).");
      } finally {
        await session.close();
      }
    },
    async close() { await driver.close(); },
  };
}

export async function runGraphContent(options: {
  graphPath: string; apply?: boolean; projectRoot?: string;
  loadConfig?: () => Neo4jImportConfig;
  createDriver?: (config: Neo4jImportConfig) => ContentDriver;
}): Promise<{
  graphId: string; articles: ArticleContent[]; mode: "preview" | "apply";
  result?: { written: number; alreadyPresent: number }; endpointSummary?: string;
}> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const { graph } = await loadAndValidateGraph({ graphPath: options.graphPath, projectRoot });
  const articles = await Promise.all(graph.nodes.articleVersions
    .filter((node) => node.collected)
    .map((node) => loadContent(projectRoot, graph.graphId, node)));
  if (articles.length !== graph.metadata.articleVersionsCollected) {
    throw new GraphError("GRAPH_INPUT_INVALID", "Nombre d'articles collectés incohérent.");
  }
  if (!options.apply) return { graphId: graph.graphId, articles, mode: "preview" };
  const config = (options.loadConfig ?? loadNeo4jImportConfig)();
  const driver = (options.createDriver ?? createContentDriver)(config);
  try {
    const result = await driver.apply(graph.graphId, articles);
    return { graphId: graph.graphId, articles, mode: "apply", result,
      endpointSummary: safeNeo4jEndpointSummary(config.uri, config.database) };
  } finally {
    await driver.close();
  }
}

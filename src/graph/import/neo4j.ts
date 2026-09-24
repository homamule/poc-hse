import neo4j, {
  type Driver,
  type Session,
  type ManagedTransaction,
} from "neo4j-driver";
import { GraphError } from "../errors.js";
import type { Neo4jImportConfig } from "./config.js";
import {
  CONSTRAINT_ARTICLE_VERSION,
  CONSTRAINT_RELATION_SOURCE,
  HSE_ARTICLE_VERSION_LABEL,
  HSE_RELATION_SOURCE_LABEL,
  type ArticleVersionImportProps,
  type GraphImportPlan,
  type LinkImportSpec,
  type RelationSourceImportProps,
} from "./plan.js";

export type ControlCounts = {
  collected: number;
  historical: number;
  relationSources: number;
  links: number;
};

export type GraphImportDriver = {
  readonly database: string;
  verifyConnectivity(): Promise<void>;
  ensureConstraints(): Promise<void>;
  importGraph(plan: GraphImportPlan): Promise<void>;
  readControlCounts(graphId: string): Promise<ControlCounts>;
  close(): Promise<void>;
};

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function propsCompatible(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in existing)) {
      return false;
    }
    const actual = existing[key];
    if (actual === expectedValue) continue;
    // neo4j integer vs number
    if (
      typeof expectedValue === "number" &&
      asNumber(actual) === expectedValue
    ) {
      continue;
    }
    if (actual == null && expectedValue == null) continue;
    if (String(actual) === String(expectedValue)) continue;
    return false;
  }
  return true;
}

function toStoredProps(
  props: ArticleVersionImportProps | RelationSourceImportProps,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

async function upsertNode(
  tx: ManagedTransaction,
  label: string,
  props: Record<string, unknown>,
): Promise<void> {
  const key = props.key;
  const result = await tx.run(
    `MATCH (n:${label} {key: $key}) RETURN properties(n) AS props`,
    { key },
  );
  if (result.records.length > 0) {
    const existing = result.records[0]!.get("props") as Record<string, unknown>;
    if (!propsCompatible(existing, props)) {
      throw new GraphError(
        "GRAPH_IMPORT_CONFLICT",
        `Nœud ${label} déjà présent avec des données incompatibles (key). Import annulé.`,
      );
    }
    return;
  }
  await tx.run(`CREATE (n:${label}) SET n = $props`, { props });
}

async function mergeLink(
  tx: ManagedTransaction,
  link: LinkImportSpec,
): Promise<void> {
  // Labels interpolés depuis des constantes internes uniquement (pas d'entrée utilisateur).
  const cypher = `
    MATCH (a:${link.fromLabel} {key: $fromKey})
    MATCH (b:${link.toLabel} {key: $toKey})
    MERGE (a)-[r:${link.type} {graphId: $graphId}]->(b)
  `;
  await tx.run(cypher, {
    fromKey: link.fromKey,
    toKey: link.toKey,
    graphId: link.graphId,
  });
}

/**
 * Pilote Neo4j réel (neo4j-driver), base ciblée explicitement.
 */
export function createNeo4jImportDriver(
  config: Neo4jImportConfig,
): GraphImportDriver {
  const driver: Driver = neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.user, config.password),
  );
  const database = config.database;

  const session = (): Session => driver.session({ database });

  return {
    database,

    async verifyConnectivity(): Promise<void> {
      const s = session();
      try {
        await s.run("RETURN 1 AS ok");
      } catch {
        throw new GraphError(
          "GRAPH_NEO4J",
          "Échec de connexion à Neo4j (détails non exposés).",
        );
      } finally {
        await s.close();
      }
    },

    async ensureConstraints(): Promise<void> {
      const s = session();
      try {
        // Syntaxe Neo4j 5.x (compatible Aura / Neo4j 5)
        await s.run(`
          CREATE CONSTRAINT ${CONSTRAINT_ARTICLE_VERSION} IF NOT EXISTS
          FOR (n:${HSE_ARTICLE_VERSION_LABEL})
          REQUIRE n.key IS UNIQUE
        `);
        await s.run(`
          CREATE CONSTRAINT ${CONSTRAINT_RELATION_SOURCE} IF NOT EXISTS
          FOR (n:${HSE_RELATION_SOURCE_LABEL})
          REQUIRE n.key IS UNIQUE
        `);
      } catch {
        throw new GraphError(
          "GRAPH_NEO4J",
          "Échec lors de la création des contraintes Neo4j (détails non exposés).",
        );
      } finally {
        await s.close();
      }
    },

    async importGraph(plan: GraphImportPlan): Promise<void> {
      const s = session();
      try {
        await s.executeWrite(async (tx) => {
          for (const node of plan.articleVersions) {
            await upsertNode(
              tx,
              HSE_ARTICLE_VERSION_LABEL,
              toStoredProps(node),
            );
          }
          for (const node of plan.relationSources) {
            await upsertNode(
              tx,
              HSE_RELATION_SOURCE_LABEL,
              toStoredProps(node),
            );
          }
          for (const link of plan.links) {
            await mergeLink(tx, link);
          }
        });
      } catch (error) {
        if (error instanceof GraphError) throw error;
        throw new GraphError(
          "GRAPH_NEO4J",
          "Échec de l'import Neo4j (détails non exposés).",
        );
      } finally {
        await s.close();
      }
    },

    async readControlCounts(graphId: string): Promise<ControlCounts> {
      const s = session();
      try {
        const collected = await s.run(
          `MATCH (n:${HSE_ARTICLE_VERSION_LABEL} {graphId: $graphId, collected: true})
           RETURN count(n) AS c`,
          { graphId },
        );
        const historical = await s.run(
          `MATCH (n:${HSE_ARTICLE_VERSION_LABEL} {graphId: $graphId, collected: false})
           RETURN count(n) AS c`,
          { graphId },
        );
        const relationSources = await s.run(
          `MATCH (n:${HSE_RELATION_SOURCE_LABEL} {graphId: $graphId})
           RETURN count(n) AS c`,
          { graphId },
        );
        const links = await s.run(
          `MATCH ()-[r {graphId: $graphId}]->()
           WHERE type(r) IN ['OBSERVATION_DANS', 'REFERENCE_IDENTIFIANT']
           RETURN count(r) AS c`,
          { graphId },
        );
        return {
          collected: asNumber(collected.records[0]?.get("c")),
          historical: asNumber(historical.records[0]?.get("c")),
          relationSources: asNumber(relationSources.records[0]?.get("c")),
          links: asNumber(links.records[0]?.get("c")),
        };
      } catch (error) {
        if (error instanceof GraphError) throw error;
        throw new GraphError(
          "GRAPH_NEO4J",
          "Échec de la lecture de contrôle Neo4j (détails non exposés).",
        );
      } finally {
        await s.close();
      }
    },

    async close(): Promise<void> {
      await driver.close();
    },
  };
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import neo4j, { type Driver } from "neo4j-driver";
import { getProjectRoot } from "../../normalize/load.js";
import { runGraphContent } from "../content/run.js";
import { GraphError } from "../errors.js";
import { loadNeo4jImportConfig, safeNeo4jEndpointSummary, type Neo4jImportConfig } from "../import/config.js";
import { nodeKey } from "../import/plan.js";
import { PASSAGE_POLICY_VERSION, splitAtHtmlParagraphs, type PassageDocument } from "./run.js";

type ArticleSource = PassageDocument["articles"][number];

export type PassageImportRow = {
  key: string;
  graphId: string;
  passageSetId: string;
  id: string;
  articleId: string;
  articleKey: string;
  index: number;
  start: number;
  end: number;
  texte: string;
  texteSha256: string;
  collectionId: string;
  bodySha256: string;
  normalizedPath: string;
  articleTexteSha256: string;
};

export type PassageImportDriver = {
  apply(document: PassageDocument, rows: PassageImportRow[]): Promise<"written" | "already_present">;
  close(): Promise<void>;
};

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function fail(message: string): never {
  throw new GraphError("PASSAGE_IMPORT_INVALID", message);
}

/** Validates the whole projection, including source text and deterministic IDs, before any connection. */
export async function loadPassageImport(options: { passagePath: string; projectRoot?: string }): Promise<{
  document: PassageDocument; rows: PassageImportRow[]; passagePath: string;
}> {
  const root = options.projectRoot ?? getProjectRoot();
  const absolute = path.resolve(root, options.passagePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("Chemin des passages hors projet.");
  let raw: unknown;
  try { raw = JSON.parse(await readFile(absolute, "utf8")) as unknown; }
  catch { return fail("Fichier de passages illisible."); }
  if (!object(raw) || raw.schemaVersion !== 1 || raw.passagePolicyVersion !== PASSAGE_POLICY_VERSION ||
      typeof raw.passageSetId !== "string" || !/^[a-f0-9]{64}$/.test(raw.passageSetId) ||
      typeof raw.graphId !== "string" || !/^[a-f0-9]{64}$/.test(raw.graphId) ||
      !Array.isArray(raw.articles)) fail("En-tête des passages invalide.");
  const doc = raw as PassageDocument;
  const { passageSetId: _id, ...base } = doc;
  if (sha(JSON.stringify(base)) !== doc.passageSetId ||
      path.basename(relative) !== `${doc.passageSetId}.json`) fail("Empreinte du lot de passages incohérente.");

  const source = await runGraphContent({
    projectRoot: root, graphPath: `data/graphs/${doc.graphId}.json`,
  });
  if (doc.articles.length !== source.articles.length) fail("Nombre d'articles incohérent.");
  const sourceById = new Map(source.articles.map((a) => [a.id, a]));
  const visited = new Set<string>();
  const rows: PassageImportRow[] = [];
  for (const article of doc.articles) {
    if (!object(article) || typeof article.id !== "string" || visited.has(article.id)) fail("Article répété ou invalide.");
    visited.add(article.id);
    const original = sourceById.get(article.id);
    if (!original || article.num !== original.num || article.collectionId !== original.collectionId ||
        article.bodySha256 !== original.bodySha256 || article.normalizedPath !== original.normalizedPath ||
        article.articleTexteSha256 !== original.texteSha256 || !Array.isArray(article.passages) ||
        article.passages.length === 0) fail(`Provenance d'article invalide : ${article.id}.`);
    let normalized: unknown;
    try { normalized = JSON.parse(await readFile(path.join(root, original.normalizedPath), "utf8")) as unknown; }
    catch { return fail(`Fichier normalisé illisible : ${article.id}.`); }
    if (!object(normalized) || !object(normalized.content) ||
        normalized.content.texte !== original.texte || typeof normalized.content.texteHtml !== "string" ||
        JSON.stringify(splitAtHtmlParagraphs(original, normalized.content.texteHtml)) !==
          JSON.stringify(article.passages)) {
      fail(`Passages différents du découpage source : ${article.id}.`);
    }
    let offset = 0;
    for (let index = 0; index < article.passages.length; index++) {
      const passage = article.passages[index];
      if (!object(passage) || passage.articleId !== article.id || passage.index !== index ||
          !Number.isSafeInteger(passage.start) || !Number.isSafeInteger(passage.end) ||
          passage.start !== offset || passage.end <= offset || passage.end > original.texte.length ||
          typeof passage.texte !== "string" || passage.texte.trim() === "" ||
          passage.texte !== original.texte.slice(passage.start, passage.end) ||
          passage.texteSha256 !== sha(passage.texte) ||
          passage.id !== sha(JSON.stringify([PASSAGE_POLICY_VERSION, original.key, index, passage.texteSha256]))) {
        fail(`Passage ou position invalide : ${article.id}#${index}.`);
      }
      offset = passage.end;
      rows.push({
        key: nodeKey(doc.passageSetId, passage.id), graphId: doc.graphId,
        passageSetId: doc.passageSetId, id: passage.id, articleId: article.id,
        articleKey: original.key, index, start: passage.start, end: passage.end,
        texte: passage.texte, texteSha256: passage.texteSha256,
        collectionId: article.collectionId, bodySha256: article.bodySha256,
        normalizedPath: article.normalizedPath, articleTexteSha256: article.articleTexteSha256,
      });
    }
    if (offset !== original.texte.length) fail(`Article incomplet : ${article.id}.`);
  }
  if (rows.length === 0) fail("Aucun passage à importer.");
  return { document: doc, rows, passagePath: relative.split(path.sep).join("/") };
}

function sameProps(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const found = actual[key];
    if (typeof value === "number" && object(found) && typeof found.toNumber === "function") {
      return found.toNumber() === value;
    }
    return found === value;
  });
}

export function checkArticleNode(actual: Record<string, unknown>, row: PassageImportRow): void {
  if (!sameProps(actual, { key: row.articleKey, graphId: row.graphId,
    id: row.articleId, collected: true, collectionId: row.collectionId,
    bodySha256: row.bodySha256, normalizedPath: row.normalizedPath,
    texteSha256: row.articleTexteSha256 }) ||
      typeof actual.texte !== "string" || sha(actual.texte) !== row.articleTexteSha256) {
    throw new GraphError("PASSAGE_IMPORT_CONFLICT", `Article absent, sans texte, ou provenance différente : ${row.articleId}.`);
  }
}

function passageProps(row: PassageImportRow): Record<string, string | number> {
  const { articleKey: _articleKey, ...props } = row;
  return props;
}

export function classifyPassageState(
  rows: PassageImportRow[],
  passages: Record<string, unknown>[],
  edges: Array<{ articleKey: string; passageKey: string }>,
): "write" | "already_present" {
  if (passages.length === 0 && edges.length === 0) return "write";
  if (passages.length !== rows.length || edges.length !== rows.length) {
    throw new GraphError("PASSAGE_IMPORT_CONFLICT", "Lot de passages déjà présent mais incomplet.");
  }
  const byPassage = new Map<string, Record<string, unknown>>();
  for (const props of passages) {
    if (typeof props.key !== "string" || byPassage.has(props.key)) {
      throw new GraphError("PASSAGE_IMPORT_CONFLICT", "Passages dupliqués.");
    }
    byPassage.set(props.key, props);
  }
  const edgeKeys = new Set(edges.map((edge) => `${edge.articleKey}\u0000${edge.passageKey}`));
  if (edgeKeys.size !== rows.length || rows.some((row) =>
    !sameProps(byPassage.get(row.key) ?? {}, passageProps(row)) ||
    !edgeKeys.has(`${row.articleKey}\u0000${row.key}`))) {
    throw new GraphError("PASSAGE_IMPORT_CONFLICT", "Passages déjà présents avec des données incompatibles.");
  }
  return "already_present";
}

export function createPassageImportDriver(config: Neo4jImportConfig): PassageImportDriver {
  const driver: Driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
  return {
    async apply(document, rows) {
      const session = driver.session({ database: config.database });
      try {
        await session.run(
          "CREATE CONSTRAINT hse_passage_key IF NOT EXISTS FOR (p:HsePassage) REQUIRE p.key IS UNIQUE",
        );
        return await session.executeWrite(async (tx) => {
          // All checks and writes occur in one transaction; an error rolls back the whole lot.
          const articleKeys = [...new Set(rows.map((row) => row.articleKey))];
          const parents = await tx.run(
            "MATCH (a:HseArticleVersion) WHERE a.key IN $keys RETURN properties(a) AS props",
            { keys: articleKeys },
          );
          if (parents.records.length !== articleKeys.length) {
            throw new GraphError("PASSAGE_IMPORT_MISSING", "Articles sources absents dans Neo4j.");
          }
          const byKey = new Map<string, Record<string, unknown>>();
          for (const record of parents.records) {
            const props = record.get("props") as Record<string, unknown>;
            if (typeof props.key !== "string" || byKey.has(props.key)) {
              throw new GraphError("PASSAGE_IMPORT_CONFLICT", "Clés d'articles dupliquées.");
            }
            byKey.set(props.key, props);
          }
          for (const row of rows) {
            const parent = byKey.get(row.articleKey);
            if (!parent) throw new GraphError("PASSAGE_IMPORT_MISSING", `Article absent : ${row.articleId}.`);
            checkArticleNode(parent, row);
          }
          const existing = await tx.run(
            "MATCH (p:HsePassage {passageSetId: $passageSetId}) RETURN properties(p) AS props",
            { passageSetId: document.passageSetId },
          );
          const existingEdges = await tx.run(
            "MATCH (a:HseArticleVersion)-[r:A_POUR_PASSAGE {passageSetId: $passageSetId}]->(p:HsePassage) " +
            "RETURN a.key AS articleKey, p.key AS passageKey",
            { passageSetId: document.passageSetId },
          );
          const state = classifyPassageState(
            rows,
            existing.records.map((record) => record.get("props") as Record<string, unknown>),
            existingEdges.records.map((record) => ({
              articleKey: String(record.get("articleKey")),
              passageKey: String(record.get("passageKey")),
            })),
          );
          if (state === "already_present") {
            return "already_present";
          }
          for (const row of rows) {
            const result = await tx.run(
              "MATCH (a:HseArticleVersion {key: $articleKey, graphId: $graphId, collected: true}) " +
              "CREATE (p:HsePassage) SET p = $props " +
              "CREATE (a)-[:A_POUR_PASSAGE {passageSetId: $passageSetId}]->(p) " +
              "RETURN count(p) AS count",
              { articleKey: row.articleKey, graphId: row.graphId,
                props: passageProps(row), passageSetId: document.passageSetId },
            );
            if (Number(result.records[0]?.get("count")) !== 1) {
              throw new GraphError("PASSAGE_IMPORT_MISSING", `Article absent pendant l'import : ${row.articleId}.`);
            }
          }
          return "written";
        });
      } catch (error) {
        if (error instanceof GraphError) throw error;
        throw new GraphError("GRAPH_NEO4J", "Échec de l'import des passages (détails non exposés).");
      } finally { await session.close(); }
    },
    async close() { await driver.close(); },
  };
}

export async function runPassageImport(options: {
  passagePath: string; apply?: boolean; projectRoot?: string;
  loadConfig?: () => Neo4jImportConfig;
  createDriver?: (config: Neo4jImportConfig) => PassageImportDriver;
}): Promise<{
  mode: "preview" | "apply"; document: PassageDocument; rows: PassageImportRow[];
  status?: "written" | "already_present"; endpointSummary?: string;
}> {
  const input = await loadPassageImport(options);
  if (!options.apply) return { mode: "preview", document: input.document, rows: input.rows };
  const config = (options.loadConfig ?? loadNeo4jImportConfig)();
  const driver = (options.createDriver ?? createPassageImportDriver)(config);
  try {
    const status = await driver.apply(input.document, input.rows);
    return { mode: "apply", document: input.document, rows: input.rows, status,
      endpointSummary: safeNeo4jEndpointSummary(config.uri, config.database) };
  } finally { await driver.close(); }
}

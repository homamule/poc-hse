import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { checkArticleNode, classifyPassageState, loadPassageImport, runPassageImport, type PassageImportDriver } from "../src/graph/passages/import.js";
import { runGraphPassages } from "../src/graph/passages/run.js";
import type { GraphDocument } from "../src/graph/types.js";

const roots: string[] = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<{ root: string; passagePath: string; normalizedPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "hse-passages-import-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "graphs"), { recursive: true });
  await mkdir(path.join(root, "data", "normalized"), { recursive: true });
  const node = { kind: "ArticleVersion" as const, collected: true as const,
    id: "LEGIARTI000000000001", num: "L4121-1", cid: "CID1", etat: "VIGUEUR",
    collectionId: "col-a", bodySha256: "aa".repeat(32),
    normalizedPath: "data/normalized/col-a_v1.0.0.json" };
  const graph: GraphDocument = {
    schemaVersion: 1, graphPolicyVersion: "1.0.0", graphId: "a".repeat(64),
    inventoryId: "inv-test-001", inventoryPath: "data/relation-inventories/inv-test-001.json",
    metadata: { articleVersionsCollected: 1, articleVersionsHistorical: 0, relationSources: 0,
      links: 0, nonResolueCount: 0, projectedEntryCount: 0 },
    nodes: { articleVersions: [node], relationSources: [] }, links: [],
  };
  await writeFile(path.join(root, "data/graphs", `${graph.graphId}.json`), JSON.stringify(graph));
  const texte = "Première règle. Deuxième règle. ";
  await writeFile(path.join(root, node.normalizedPath), JSON.stringify({
    schemaVersion: 1, identity: { id: node.id },
    provenance: { collectionId: node.collectionId, bodySha256: node.bodySha256 },
    content: { texte, texteHtml: "<p>Première règle.</p><p>Deuxième règle.</p>" },
  }));
  const output = await runGraphPassages({ projectRoot: root, graphPath: `data/graphs/${graph.graphId}.json` });
  return { root, passagePath: output.path, normalizedPath: node.normalizedPath };
}

describe("import contrôlé des passages", () => {
  it("aperçu valide les passages et ne charge aucun identifiant", async () => {
    const f = await fixture();
    const result = await runPassageImport({ projectRoot: f.root, passagePath: f.passagePath,
      loadConfig: () => { throw Error("config accessed"); },
      createDriver: () => { throw Error("driver accessed"); } });
    assert.equal(result.mode, "preview");
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.index, 0);
    assert.equal(result.rows[1]?.index, 1);
    assert.equal(result.rows[0]?.key.split(":")[0], result.document.passageSetId);
  });

  it("rejette lot modifié et texte normalisé modifié avant de se connecter", async () => {
    const f = await fixture();
    const absolute = path.join(f.root, f.passagePath);
    const saved = await readFile(absolute, "utf8");
    const modified = JSON.parse(saved) as { articles: Array<{ passages: Array<{ texte: string }> }> };
    modified.articles[0]!.passages[0]!.texte = "Texte altéré.";
    await writeFile(absolute, JSON.stringify(modified));
    await assert.rejects(loadPassageImport({ projectRoot: f.root, passagePath: f.passagePath }), /Empreinte/);
    await writeFile(absolute, saved);
    const normalized = path.join(f.root, f.normalizedPath);
    const source = JSON.parse(await readFile(normalized, "utf8")) as { content: { texte: string } };
    source.content.texte = "Texte altéré.";
    await writeFile(normalized, JSON.stringify(source));
    await assert.rejects(loadPassageImport({ projectRoot: f.root, passagePath: f.passagePath }), /Provenance|Passages/);
  });

  it("vérifie le texte et l'identité du parent Neo4j", async () => {
    const f = await fixture();
    const row = (await loadPassageImport({ projectRoot: f.root, passagePath: f.passagePath })).rows[0]!;
    const parent = {
      key: row.articleKey, graphId: row.graphId, id: row.articleId, collected: true,
      collectionId: row.collectionId, bodySha256: row.bodySha256,
      normalizedPath: row.normalizedPath, texteSha256: row.articleTexteSha256,
      texte: "Première règle. Deuxième règle. ",
    };
    assert.doesNotThrow(() => checkArticleNode(parent, row));
    assert.throws(() => checkArticleNode({ ...parent, texte: "Autre texte" }, row), /provenance différente/);
    assert.throws(() => checkArticleNode({ ...parent, collected: false }, row), /provenance différente/);
  });

  it("distingue lot neuf, relance exacte, lien manquant et contenu divergent", async () => {
    const f = await fixture();
    const rows = (await loadPassageImport({ projectRoot: f.root, passagePath: f.passagePath })).rows;
    const passages = rows.map(({ articleKey: _articleKey, ...props }) => ({ ...props }));
    const edges = rows.map((row) => ({ articleKey: row.articleKey, passageKey: row.key }));
    assert.equal(classifyPassageState(rows, [], []), "write");
    assert.equal(classifyPassageState(rows, passages, edges), "already_present");
    assert.throws(() => classifyPassageState(rows, passages, edges.slice(1)), /incomplet/);
    assert.throws(() => classifyPassageState(rows, passages, [edges[1]!, edges[0]!].map((edge, i) =>
      i === 0 ? { ...edge, articleKey: "mauvais-parent" } : edge)), /incompatibles/);
    assert.throws(() => classifyPassageState(rows, [{ ...passages[0], texte: "altéré" }, passages[1]!], edges), /incompatibles/);
  });

  it("import simulé : écrit une fois, accepte la relance, propage un conflit", async () => {
    const f = await fixture();
    let state: "empty" | "written" | "conflict" = "empty";
    let closed = 0;
    const mock: PassageImportDriver = {
      async apply(_doc, rows) {
        assert.equal(rows.length, 2);
        if (state === "conflict") throw Error("Lot différent");
        if (state === "written") return "already_present";
        state = "written";
        return "written";
      },
      async close() { closed++; },
    };
    const options = { projectRoot: f.root, passagePath: f.passagePath, apply: true,
      loadConfig: () => ({ uri: "neo4j+s://example.test", user: "neo4j", password: "fake", database: "neo4j" }),
      createDriver: () => mock };
    assert.equal((await runPassageImport(options)).status, "written");
    assert.equal((await runPassageImport(options)).status, "already_present");
    state = "conflict";
    await assert.rejects(runPassageImport(options), /Lot différent/);
    assert.equal(closed, 3);
  });
});

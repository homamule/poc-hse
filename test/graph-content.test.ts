import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { classifyExisting, runGraphContent, type ArticleContent, type ContentDriver } from "../src/graph/content/run.js";
import type { GraphDocument } from "../src/graph/types.js";

const roots: string[] = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<{ root: string; graphPath: string; graph: GraphDocument; edit: (patch: Record<string, unknown>) => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "hse-content-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "graphs"), { recursive: true });
  await mkdir(path.join(root, "data", "normalized"), { recursive: true });
  const node = {
    kind: "ArticleVersion" as const, id: "LEGIARTI000000000001", collected: true as const,
    num: "L4121-1", cid: "CID1", etat: "VIGUEUR", collectionId: "col-a",
    bodySha256: "aa".repeat(32), normalizedPath: "data/normalized/col-a_v1.0.0.json",
  };
  const graph: GraphDocument = {
    schemaVersion: 1, graphPolicyVersion: "1.0.0", graphId: "graph-test-001",
    inventoryId: "inv-test-001", inventoryPath: "data/relation-inventories/inv-test-001.json",
    metadata: { articleVersionsCollected: 1, articleVersionsHistorical: 0, relationSources: 0,
      links: 0, nonResolueCount: 0, projectedEntryCount: 0 },
    nodes: { articleVersions: [node], relationSources: [] }, links: [],
  };
  const graphPath = `data/graphs/${graph.graphId}.json`;
  await writeFile(path.join(root, graphPath), JSON.stringify(graph));
  const edit = async (patch: Record<string, unknown>) => {
    const normalized = { schemaVersion: 1, identity: { id: node.id },
      provenance: { collectionId: node.collectionId, bodySha256: node.bodySha256 },
      content: { texte: "Texte exact d'essai." }, ...patch };
    await writeFile(path.join(root, node.normalizedPath), JSON.stringify(normalized));
  };
  await edit({});
  return { root, graphPath, graph, edit };
}

function stored(a: ArticleContent): Record<string, unknown> {
  return { key: a.key, id: a.id, graphId: a.key.split(":")[0], collected: true,
    collectionId: a.collectionId, bodySha256: a.bodySha256, normalizedPath: a.normalizedPath };
}

describe("graph:content", () => {
  it("aperçu local : texte exact, SHA-256, aucune configuration ni connexion", async () => {
    const f = await fixture();
    const result = await runGraphContent({ projectRoot: f.root, graphPath: f.graphPath,
      loadConfig: () => { throw Error("config accessed"); },
      createDriver: () => { throw Error("driver accessed"); } });
    assert.equal(result.mode, "preview");
    assert.equal(result.articles[0]?.texte, "Texte exact d'essai.");
    assert.match(result.articles[0]!.texteSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.articles[0]?.texteSource, "content.texte");
  });

  it("refuse une provenance incohérente et un texte absent", async () => {
    const f = await fixture();
    await f.edit({ identity: { id: "LEGIARTI000000000002" } });
    await assert.rejects(runGraphContent({ projectRoot: f.root, graphPath: f.graphPath }), /Provenance/);
    await f.edit({ content: { texte: "  " } });
    await assert.rejects(runGraphContent({ projectRoot: f.root, graphPath: f.graphPath }), /Texte source/);
  });

  it("répétition identique et conflit sont distingués sans écrasement", async () => {
    const f = await fixture();
    const nodes = new Map<string, Record<string, unknown>>();
    let closed = 0;
    const driver: ContentDriver = {
      async apply(_graphId, articles) {
        // Mock de l'opération entière : classe tous les nœuds avant écriture.
        const pending: ArticleContent[] = [];
        for (const a of articles) {
          const old = nodes.get(a.key) ?? stored(a);
          if (classifyExisting(old, a) === "write") pending.push(a);
        }
        for (const a of pending) nodes.set(a.key, { ...stored(a), texte: a.texte,
          texteSha256: a.texteSha256, texteSource: a.texteSource });
        return { written: pending.length, alreadyPresent: articles.length - pending.length };
      },
      async close() { closed++; },
    };
    const opts = { projectRoot: f.root, graphPath: f.graphPath, apply: true,
      loadConfig: () => ({ uri: "neo4j+s://example.test", user: "neo4j", password: "fake", database: "neo4j" }),
      createDriver: () => driver };
    assert.deepEqual((await runGraphContent(opts)).result, { written: 1, alreadyPresent: 0 });
    assert.deepEqual((await runGraphContent(opts)).result, { written: 0, alreadyPresent: 1 });
    const key = `${f.graph.graphId}:LEGIARTI000000000001`;
    nodes.get(key)!.texte = "autre texte";
    await assert.rejects(runGraphContent(opts), /valeurs différentes/);
    assert.equal(nodes.get(key)?.texte, "autre texte");
    assert.equal(closed, 3);
  });

  it("un nœud absent ou historique ne peut recevoir le texte", async () => {
    const f = await fixture();
    const a = (await runGraphContent({ projectRoot: f.root, graphPath: f.graphPath })).articles[0]!;
    assert.throws(() => classifyExisting({ ...stored(a), collected: false }, a), /incohérent/);
    const driver: ContentDriver = {
      async apply() { throw Error("Nœud absent"); }, async close() {},
    };
    await assert.rejects(runGraphContent({ projectRoot: f.root, graphPath: f.graphPath, apply: true,
      loadConfig: () => ({ uri: "bolt://localhost", user: "u", password: "p", database: "neo4j" }),
      createDriver: () => driver }), /Nœud absent/);
  });
});

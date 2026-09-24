import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { runGraphPassages, splitAtHtmlParagraphs } from "../src/graph/passages/run.js";
import type { ArticleContent } from "../src/graph/content/run.js";
import type { GraphDocument } from "../src/graph/types.js";

const roots: string[] = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

const texte = "Premier texte.  Deuxième texte, avec lien. Troisième. ";
const html = "<p>Premier texte.</p><p>Deuxième texte, avec <a href=\"/x\">lien</a>.</p><p>Troisième.</p><p><br/></p>";
const node = { kind: "ArticleVersion" as const, collected: true as const, id: "LEGIARTI000000000001",
  num: "L4121-1", cid: "CID1", etat: "VIGUEUR", collectionId: "col-a",
  bodySha256: "aa".repeat(32), normalizedPath: "data/normalized/col-a_v1.0.0.json" };

function content(): ArticleContent {
  return { key: `graph-test-001:${node.id}`, id: node.id, num: node.num,
    collectionId: node.collectionId, bodySha256: node.bodySha256, normalizedPath: node.normalizedPath,
    texte, texteSha256: "a".repeat(64), texteSource: "content.texte" };
}

async function fixture(): Promise<{ root: string; graphPath: string; writeNorm: (plain: string, markup: string) => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "hse-passages-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "graphs"), { recursive: true });
  await mkdir(path.join(root, "data", "normalized"), { recursive: true });
  const graph: GraphDocument = { schemaVersion: 1, graphPolicyVersion: "1.0.0",
    graphId: "graph-test-001", inventoryId: "inv-test-001",
    inventoryPath: "data/relation-inventories/inv-test-001.json",
    metadata: { articleVersionsCollected: 1, articleVersionsHistorical: 0,
      relationSources: 0, links: 0, nonResolueCount: 0, projectedEntryCount: 0 },
    nodes: { articleVersions: [node], relationSources: [] }, links: [] };
  const graphPath = `data/graphs/${graph.graphId}.json`;
  await writeFile(path.join(root, graphPath), JSON.stringify(graph));
  const writeNorm = async (plain: string, markup: string) => {
    await writeFile(path.join(root, node.normalizedPath), JSON.stringify({ schemaVersion: 1,
      identity: { id: node.id }, provenance: { collectionId: node.collectionId, bodySha256: node.bodySha256 },
      content: { texte: plain, texteHtml: markup } }));
  };
  await writeNorm(texte, html);
  return { root, graphPath, writeNorm };
}

describe("paragraphes sourcés", () => {
  it("conserve des sous-chaînes exactes et des offsets qui reconstruisent le texte", () => {
    const parts = splitAtHtmlParagraphs(content(), html);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.map((p) => p.index), [0, 1, 2]);
    assert.equal(parts.map((p) => p.texte).join(""), texte);
    for (const part of parts) {
      assert.equal(texte.slice(part.start, part.end), part.texte);
      assert.match(part.texteSha256, /^[0-9a-f]{64}$/);
    }
  });

  it("rejette un HTML divergent et n'invente aucun passage", () => {
    assert.throws(() => splitAtHtmlParagraphs(content(), "<p>Autre texte.</p>"), /divergents/);
    assert.throws(() => splitAtHtmlParagraphs(content(), "<p>&mystere;</p>"), /non prise en charge/);
  });

  it("écrit une seule sortie locale déterministe et relance sans modification", async () => {
    const f = await fixture();
    const first = await runGraphPassages({ graphPath: f.graphPath, projectRoot: f.root });
    assert.equal(first.publishStatus, "written");
    assert.equal(first.document.articles[0]?.passages.length, 3);
    const json = JSON.parse(await readFile(path.join(f.root, first.path), "utf8"));
    assert.deepEqual(json, first.document);
    const second = await runGraphPassages({ graphPath: f.graphPath, projectRoot: f.root });
    assert.equal(second.publishStatus, "already_identical");
    assert.equal(second.document.passageSetId, first.document.passageSetId);
  });

  it("bloque la projection si une frontière HTML ne correspond plus au texte", async () => {
    const f = await fixture();
    await f.writeNorm(texte, "<p>Premier texte.</p><p>Deuxième texte changé.</p>");
    await assert.rejects(runGraphPassages({ graphPath: f.graphPath, projectRoot: f.root }), /divergents/);
  });
});

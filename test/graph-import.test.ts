import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GraphError, isGraphError } from "../src/graph/errors.js";
import { safeNeo4jEndpointSummary } from "../src/graph/import/config.js";
import {
  HSE_ARTICLE_VERSION_LABEL,
  HSE_RELATION_SOURCE_LABEL,
  nodeKey,
  type GraphImportPlan,
} from "../src/graph/import/plan.js";
import {
  type ControlCounts,
  type GraphImportDriver,
} from "../src/graph/import/neo4j.js";
import { runGraphImport } from "../src/graph/import/run.js";
import { validateGraphDocument } from "../src/graph/import/validate.js";
import type { GraphDocument } from "../src/graph/types.js";

const ROOTS: string[] = [];
const REAL_GRAPH =
  "data/graphs/166b806665c9e232c138c800f7b1593cbf9de5c5a5eb82eff563e6c00215ebff.json";

after(async () => {
  for (const root of ROOTS) {
    await rm(root, { recursive: true, force: true });
  }
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "graph-import-"));
  ROOTS.push(root);
  await mkdir(path.join(root, "data", "graphs"), { recursive: true });
  return root;
}

async function writeGraph(
  root: string,
  graph: GraphDocument,
): Promise<string> {
  const relative = `data/graphs/${graph.graphId}.json`;
  await writeFile(
    path.join(root, relative),
    `${JSON.stringify(graph, null, 2)}\n`,
    "utf8",
  );
  return relative;
}

function minimalValidGraph(): GraphDocument {
  const graphId = "graph-test-001";
  const inventoryId = "inv-test-001";
  const avCollected = {
    kind: "ArticleVersion" as const,
    id: "LEGIARTI000000000001",
    collected: true as const,
    num: "L4121-1",
    cid: "CID1",
    etat: "VIGUEUR",
    collectionId: "col-a",
    bodySha256: "aa".repeat(32),
    normalizedPath: "data/normalized/col-a_v1.0.0.json",
  };
  const avCollected2 = {
    kind: "ArticleVersion" as const,
    id: "LEGIARTI000000000002",
    collected: true as const,
    num: "L4121-2",
    cid: "CID2",
    etat: "VIGUEUR",
    collectionId: "col-b",
    bodySha256: "bb".repeat(32),
    normalizedPath: "data/normalized/col-b_v1.0.0.json",
  };
  const avHist = {
    kind: "ArticleVersion" as const,
    id: "LEGIARTI000000009901",
    collected: false as const,
    articleNum: "L4121-1",
  };
  const rsId = "RelationSource:aaaa";
  const rs = {
    kind: "RelationSource" as const,
    id: rsId,
    inventoryId,
    sourceCollectionId: "col-a",
    family: "lienCitations" as const,
    index: 0,
    linkType: "CITATION",
    linkOrientation: "cible",
    resolutionClass: "autre_version_connue" as const,
    referencedArticleId: avHist.id,
    pointer: {
      normalizedPath: avCollected.normalizedPath,
      family: "lienCitations" as const,
      index: 0,
    },
  };

  return {
    schemaVersion: 1,
    graphPolicyVersion: "1.0.0",
    graphId,
    inventoryId,
    inventoryPath: "data/relation-inventories/inv-test-001.json",
    metadata: {
      articleVersionsCollected: 2,
      articleVersionsHistorical: 1,
      relationSources: 1,
      links: 2,
      nonResolueCount: 5,
      projectedEntryCount: 1,
    },
    nodes: {
      articleVersions: [avCollected, avCollected2, avHist],
      relationSources: [rs],
    },
    links: [
      {
        type: "OBSERVATION_DANS",
        from: avCollected.id,
        to: rsId,
      },
      {
        type: "REFERENCE_IDENTIFIANT",
        from: rsId,
        to: avHist.id,
      },
    ],
  };
}

type MockState = {
  nodes: Map<string, Record<string, unknown>>;
  links: Array<{ type: string; fromKey: string; toKey: string; graphId: string }>;
  databases: string[];
  constraints: string[];
  importCalls: number;
  closed: boolean;
};

function createMockDriver(state: MockState): GraphImportDriver {
  return {
    database: "neo4j-test",
    async verifyConnectivity() {
      state.databases.push("neo4j-test");
    },
    async ensureConstraints() {
      state.constraints.push("article", "relation");
    },
    async importGraph(plan: GraphImportPlan) {
      state.importCalls += 1;
      const pendingNodes = new Map(
        [...state.nodes.entries()].map(([k, v]) => [k, { ...v }]),
      );
      const pendingLinks = state.links.map((l) => ({ ...l }));

      const upsert = (label: string, props: Record<string, unknown>) => {
        const key = String(props.key);
        const existing = pendingNodes.get(key);
        if (existing) {
          for (const [k, v] of Object.entries(props)) {
            if (existing[k] !== v && String(existing[k]) !== String(v)) {
              throw new GraphError(
                "GRAPH_IMPORT_CONFLICT",
                `Nœud ${label} déjà présent avec des données incompatibles (key). Import annulé.`,
              );
            }
          }
          return;
        }
        pendingNodes.set(key, { ...props, _label: label });
      };

      for (const n of plan.articleVersions) {
        upsert(HSE_ARTICLE_VERSION_LABEL, { ...n });
      }
      for (const n of plan.relationSources) {
        upsert(HSE_RELATION_SOURCE_LABEL, { ...n });
      }
      for (const link of plan.links) {
        const exists = pendingLinks.some(
          (l) =>
            l.type === link.type &&
            l.fromKey === link.fromKey &&
            l.toKey === link.toKey &&
            l.graphId === link.graphId,
        );
        if (!exists) {
          pendingLinks.push({
            type: link.type,
            fromKey: link.fromKey,
            toKey: link.toKey,
            graphId: link.graphId,
          });
        }
      }
      state.nodes = pendingNodes;
      state.links = pendingLinks;
    },
    async readControlCounts(graphId: string): Promise<ControlCounts> {
      let collected = 0;
      let historical = 0;
      let relationSources = 0;
      for (const node of state.nodes.values()) {
        if (node.graphId !== graphId) continue;
        if (node._label === HSE_ARTICLE_VERSION_LABEL) {
          if (node.collected === true) collected += 1;
          else historical += 1;
        }
        if (node._label === HSE_RELATION_SOURCE_LABEL) {
          relationSources += 1;
        }
      }
      const links = state.links.filter((l) => l.graphId === graphId).length;
      return { collected, historical, relationSources, links };
    },
    async close() {
      state.closed = true;
    },
  };
}

describe("validateGraphDocument", () => {
  it("accepte un graphe cohérent", () => {
    const graph = validateGraphDocument(minimalValidGraph());
    assert.equal(graph.metadata.links, 2);
    assert.equal(graph.nodes.relationSources.length, 1);
  });

  it("rejette kinds ou liens invalides, comptes et historiques collectés", () => {
    const badKind = minimalValidGraph() as unknown as Record<string, unknown>;
    const nodes = badKind.nodes as {
      articleVersions: Array<Record<string, unknown>>;
    };
    nodes.articleVersions[0]!.kind = "Obligation";
    assert.throws(() => validateGraphDocument(badKind), isGraphError);

    const badLink = minimalValidGraph();
    badLink.links[0]!.type = "CITE" as "OBSERVATION_DANS";
    assert.throws(() => validateGraphDocument(badLink), isGraphError);

    const missingTarget = minimalValidGraph();
    missingTarget.links[1]!.to = "LEGIARTI_INEXISTANT";
    assert.throws(() => validateGraphDocument(missingTarget), isGraphError);

    const histCollected = minimalValidGraph();
    const hist = histCollected.nodes.articleVersions.find((n) => !n.collected);
    assert.ok(hist);
    (hist as { collectionId?: string }).collectionId = "should-not";
    assert.throws(() => validateGraphDocument(histCollected), isGraphError);

    const badCount = minimalValidGraph();
    badCount.metadata.links = 99;
    assert.throws(() => validateGraphDocument(badCount), isGraphError);
  });
});

describe("safeNeo4jEndpointSummary", () => {
  it("masque une URI avec identifiants", () => {
    const summary = safeNeo4jEndpointSummary(
      "neo4j+s://user:secret@host.example:7687",
      "neo4j",
    );
    assert.equal(summary.includes("secret"), false);
    assert.equal(summary.includes("user"), false);
    assert.match(summary, /database=neo4j/);
  });
});

describe("runGraphImport", () => {
  it("mode aperçu : validation sans lecture de config Neo4j", async () => {
    const root = await createProject();
    const graph = minimalValidGraph();
    const graphPath = await writeGraph(root, graph);

    let configReads = 0;
    const outcome = await runGraphImport({
      graphPath,
      projectRoot: root,
      apply: false,
      loadConfig: () => {
        configReads += 1;
        return {
          uri: "bolt://localhost",
          user: "neo4j",
          password: "secret",
          database: "neo4j",
        };
      },
      createDriver: () => {
        throw new Error("ne doit pas créer de driver en aperçu");
      },
    });

    assert.equal(outcome.mode, "preview");
    assert.equal(configReads, 0);
    if (outcome.mode === "preview") {
      assert.equal(outcome.preview.nodeCounts.totalNodes, 4);
      assert.equal(outcome.preview.linkCounts.total, 2);
      assert.equal(
        outcome.plan.articleVersions[0]?.key,
        nodeKey(graph.graphId, "LEGIARTI000000000001"),
      );
      assert.equal(
        outcome.plan.relationSources[0]?.key.startsWith(`${graph.graphId}:`),
        true,
      );
    }
  });

  it("import simulé : base ciblée, clés, relance sans doublon", async () => {
    const root = await createProject();
    const graph = minimalValidGraph();
    const graphPath = await writeGraph(root, graph);
    const state: MockState = {
      nodes: new Map(),
      links: [],
      databases: [],
      constraints: [],
      importCalls: 0,
      closed: false,
    };

    const first = await runGraphImport({
      graphPath,
      projectRoot: root,
      apply: true,
      loadConfig: () => ({
        uri: "bolt://localhost:7687",
        user: "neo4j",
        password: "secret-should-not-leak",
        database: "neo4j-test",
      }),
      createDriver: (config) => {
        assert.equal(config.database, "neo4j-test");
        assert.equal(config.password, "secret-should-not-leak");
        return createMockDriver(state);
      },
    });

    assert.equal(first.mode, "apply");
    assert.equal(state.importCalls, 1);
    assert.equal(state.closed, true);
    assert.equal(state.nodes.size, 4);
    assert.equal(state.links.length, 2);
    if (first.mode === "apply") {
      assert.equal(first.database, "neo4j-test");
      assert.equal(first.control.collected, 2);
      assert.equal(first.control.historical, 1);
      assert.equal(first.control.relationSources, 1);
      assert.equal(first.control.links, 2);
      assert.equal(first.endpointSummary.includes("secret"), false);
    }

    state.closed = false;
    const second = await runGraphImport({
      graphPath,
      projectRoot: root,
      apply: true,
      loadConfig: () => ({
        uri: "bolt://localhost:7687",
        user: "neo4j",
        password: "secret",
        database: "neo4j-test",
      }),
      createDriver: () => createMockDriver(state),
    });
    assert.equal(second.mode, "apply");
    assert.equal(state.importCalls, 2);
    assert.equal(state.nodes.size, 4);
    assert.equal(state.links.length, 2);
    assert.equal(state.closed, true);
  });

  it("conflit de propriétés : échec sans appliquer la transaction", async () => {
    const root = await createProject();
    const graph = minimalValidGraph();
    const graphPath = await writeGraph(root, graph);
    const state: MockState = {
      nodes: new Map(),
      links: [],
      databases: [],
      constraints: [],
      importCalls: 0,
      closed: false,
    };

    // Premier import OK
    await runGraphImport({
      graphPath,
      projectRoot: root,
      apply: true,
      loadConfig: () => ({
        uri: "bolt://localhost",
        user: "neo4j",
        password: "x",
        database: "neo4j-test",
      }),
      createDriver: () => createMockDriver(state),
    });

    // Altère une propriété stockée
    const key = nodeKey(graph.graphId, "LEGIARTI000000000001");
    const existing = state.nodes.get(key)!;
    existing.collected = false;
    const nodesBefore = state.nodes.size;
    const linksBefore = state.links.length;

    await assert.rejects(
      () =>
        runGraphImport({
          graphPath,
          projectRoot: root,
          apply: true,
          loadConfig: () => ({
            uri: "bolt://localhost",
            user: "neo4j",
            password: "x",
            database: "neo4j-test",
          }),
          createDriver: () => createMockDriver(state),
        }),
      (error: unknown) => {
        assert.ok(isGraphError(error));
        assert.equal(error.code, "GRAPH_IMPORT_CONFLICT");
        return true;
      },
    );

    assert.equal(state.nodes.size, nodesBefore);
    assert.equal(state.links.length, linksBefore);
    assert.equal(state.closed, true);
  });
});

describe("vérification locale optionnelle (graphe prévention réel)", () => {
  it("aperçu du graphe réel : 10 nœuds et 8 liens", async () => {
    let text: string;
    try {
      text = await readFile(REAL_GRAPH, "utf8");
    } catch {
      return;
    }
    const graph = validateGraphDocument(JSON.parse(text) as unknown);
    assert.equal(
      graph.metadata.articleVersionsCollected +
        graph.metadata.articleVersionsHistorical +
        graph.metadata.relationSources,
      10,
    );
    assert.equal(graph.metadata.links, 8);
    assert.equal(graph.metadata.nonResolueCount, 434);

    const outcome = await runGraphImport({
      graphPath: REAL_GRAPH,
      apply: false,
      createDriver: () => {
        throw new Error("aperçu sans driver");
      },
    });
    assert.equal(outcome.mode, "preview");
    if (outcome.mode === "preview") {
      assert.equal(outcome.preview.nodeCounts.totalNodes, 10);
      assert.equal(outcome.preview.linkCounts.total, 8);
    }
  });
});

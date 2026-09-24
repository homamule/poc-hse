import { isGraphError, GraphError } from "./graph/errors.js";
import { runGraphImport } from "./graph/import/run.js";

function parseArgs(argv: string[]): { graph: string; apply: boolean } {
  let graph: string | undefined;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--graph") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new GraphError(
          "GRAPH_USAGE",
          'Argument manquant : --graph "data/graphs/<id>.json"',
        );
      }
      graph = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--graph=")) {
      graph = arg.slice("--graph=".length);
      continue;
    }
  }

  if (!graph?.trim()) {
    throw new GraphError(
      "GRAPH_USAGE",
      'Usage : npm run graph:import -- --graph "data/graphs/<id>.json" [--apply]',
    );
  }

  return { graph: graph.trim(), apply };
}

async function main(): Promise<void> {
  const { graph, apply } = parseArgs(process.argv.slice(2));

  console.log("Import graphe Neo4j — démarrage");
  console.log(`  graphe : ${graph}`);
  console.log(`  mode   : ${apply ? "apply" : "aperçu (aucune connexion)"}`);

  const outcome = await runGraphImport({ graphPath: graph, apply });

  console.log("");
  if (outcome.mode === "preview") {
    const p = outcome.preview;
    console.log("Aperçu local — validation OK");
    console.log(`  graphId       : ${p.graphId}`);
    console.log(`  inventoryId   : ${p.inventoryId}`);
    console.log(
      `  nœuds         : ${p.nodeCounts.totalNodes} (collectés ${p.nodeCounts.articleVersionsCollected}, historiques ${p.nodeCounts.articleVersionsHistorical}, RelationSource ${p.nodeCounts.relationSources})`,
    );
    console.log(
      `  liens         : ${p.linkCounts.total} (OBSERVATION_DANS ${p.linkCounts.OBSERVATION_DANS}, REFERENCE_IDENTIFIANT ${p.linkCounts.REFERENCE_IDENTIFIANT})`,
    );
    console.log(`  non_resolue   : ${p.nonResolueCount} (hors import)`);
    console.log(`  labels Neo4j  : ${p.neo4jLabels.articleVersion}, ${p.neo4jLabels.relationSource}`);
    console.log("  clés ArticleVersion :");
    for (const key of p.sampleKeys.articleVersions) {
      console.log(`    - ${key}`);
    }
    console.log("  clés RelationSource :");
    for (const key of p.sampleKeys.relationSources) {
      console.log(`    - ${key}`);
    }
    console.log(`  ${p.note}`);
    process.exitCode = 0;
    return;
  }

  console.log("Import Neo4j terminé");
  console.log(`  graphId     : ${outcome.graphId}`);
  console.log(`  inventoryId : ${outcome.inventoryId}`);
  console.log(`  cible       : ${outcome.endpointSummary}`);
  console.log(
    `  contrôle    : collectés=${outcome.control.collected} historiques=${outcome.control.historical} RelationSource=${outcome.control.relationSources} liens=${outcome.control.links}`,
  );
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  if (isGraphError(error)) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    process.exitCode = error.exitCode;
    return;
  }

  console.error("");
  console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
  process.exitCode = 1;
});

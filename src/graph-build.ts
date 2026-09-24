import { isPublishError } from "./publish.js";
import { isGraphError, GraphError } from "./graph/errors.js";
import { runGraphBuild } from "./graph/run.js";

function parseArgs(argv: string[]): { inventory: string } {
  let inventory: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--inventory") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new GraphError(
          "GRAPH_USAGE",
          'Argument manquant : --inventory "data/relation-inventories/<id>.json"',
        );
      }
      inventory = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--inventory=")) {
      inventory = arg.slice("--inventory=".length);
      continue;
    }
  }

  if (!inventory?.trim()) {
    throw new GraphError(
      "GRAPH_USAGE",
      'Usage : npm run graph:build -- --inventory "data/relation-inventories/<id>.json"',
    );
  }

  return { inventory: inventory.trim() };
}

async function main(): Promise<void> {
  const { inventory } = parseArgs(process.argv.slice(2));

  console.log("Construction du graphe local — démarrage");
  console.log(`  inventaire : ${inventory}`);

  const outcome = await runGraphBuild({ inventoryPath: inventory });
  const { graph } = outcome;

  console.log("");
  if (outcome.publishStatus === "already_identical") {
    console.log("Déjà présent (graphe identique, aucune réécriture).");
  } else {
    console.log("Graphe publié");
  }

  console.log(`  graphId                    : ${graph.graphId}`);
  console.log(`  inventoryId                : ${graph.inventoryId}`);
  console.log(
    `  ArticleVersion collectés   : ${graph.metadata.articleVersionsCollected}`,
  );
  console.log(
    `  ArticleVersion historiques : ${graph.metadata.articleVersionsHistorical}`,
  );
  console.log(
    `  RelationSource             : ${graph.metadata.relationSources}`,
  );
  console.log(`  liens techniques           : ${graph.metadata.links}`);
  console.log(
    `  non_resolue (hors graphe)  : ${graph.metadata.nonResolueCount}`,
  );
  console.log(`  graphe                     : ${outcome.graphPathRelative}`);

  process.exitCode = 0;
}

main().catch((error: unknown) => {
  if (isGraphError(error) || isPublishError(error)) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error("Aucun graphe n'a été produit.");
    process.exitCode = error.exitCode;
    return;
  }

  console.error("");
  console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
  console.error("Aucun graphe n'a été produit.");
  process.exitCode = 1;
});

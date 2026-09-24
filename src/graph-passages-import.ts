import { GraphError, isGraphError } from "./graph/errors.js";
import { runPassageImport } from "./graph/passages/import.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let passagePath: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") { apply = true; continue; }
    if (argv[i] === "--passages" && argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      passagePath = argv[++i]; continue;
    }
    throw new GraphError("GRAPH_USAGE", 'Usage : npm run graph:passages:import -- --passages "data/passages/<id>.json" [--apply]');
  }
  if (!passagePath) {
    throw new GraphError("GRAPH_USAGE", 'Usage : npm run graph:passages:import -- --passages "data/passages/<id>.json" [--apply]');
  }
  const outcome = await runPassageImport({ passagePath, apply });
  console.log(`Passages Neo4j — ${apply ? "import terminé" : "aperçu local"}`);
  console.log(`  graphId      : ${outcome.document.graphId}`);
  console.log(`  passageSetId : ${outcome.document.passageSetId}`);
  console.log(`  articles     : ${outcome.document.articles.length}`);
  console.log(`  passages     : ${outcome.rows.length}`);
  console.log(`  liens        : ${outcome.rows.length} A_POUR_PASSAGE`);
  if (outcome.mode === "apply") {
    console.log(`  statut       : ${outcome.status === "written" ? `${outcome.rows.length} passages importés` : "déjà présents (identiques)"}`);
    console.log(`  cible        : ${outcome.endpointSummary}`);
  } else {
    console.log("  Aucune connexion Neo4j ni lecture des identifiants.");
  }
}

main().catch((error: unknown) => {
  if (isGraphError(error)) {
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    process.exitCode = error.exitCode;
  } else {
    console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
    process.exitCode = 1;
  }
});

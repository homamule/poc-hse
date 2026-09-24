import { GraphError, isGraphError } from "./graph/errors.js";
import { runGraphPassages } from "./graph/passages/run.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--graph" || !argv[1] || argv[1].startsWith("--")) {
    throw new GraphError("GRAPH_USAGE", 'Usage : npm run graph:passages -- --graph "data/graphs/<id>.json"');
  }
  const outcome = await runGraphPassages({ graphPath: argv[1] });
  console.log(outcome.publishStatus === "written" ? "Passages créés" : "Passages déjà présents (identiques)");
  console.log(`  graphId      : ${outcome.document.graphId}`);
  console.log(`  passageSetId : ${outcome.document.passageSetId}`);
  for (const article of outcome.document.articles) {
    console.log(`  ${article.num ?? article.id} : ${article.passages.length} passages`);
  }
  console.log(`  total        : ${outcome.document.articles.reduce((sum, article) => sum + article.passages.length, 0)}`);
  console.log(`  fichier      : ${outcome.path}`);
  console.log("  Aucune connexion Neo4j ni modification du graphe existant.");
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

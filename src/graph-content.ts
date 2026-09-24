import { GraphError, isGraphError } from "./graph/errors.js";
import { runGraphContent } from "./graph/content/run.js";

function parseArgs(argv: string[]): { graphPath: string; apply: boolean } {
  let graphPath: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--graph") { graphPath = argv[++i]; continue; }
    if (arg?.startsWith("--graph=")) { graphPath = arg.slice(8); continue; }
    throw new GraphError("GRAPH_USAGE", `Argument inconnu : ${arg ?? "(vide)"}.`);
  }
  if (!graphPath || graphPath.startsWith("--")) {
    throw new GraphError("GRAPH_USAGE", 'Usage : npm run graph:content -- --graph "data/graphs/<id>.json" [--apply]');
  }
  return { graphPath, apply };
}

async function main(): Promise<void> {
  const { graphPath, apply } = parseArgs(process.argv.slice(2));
  const result = await runGraphContent({ graphPath, apply });
  console.log(`Texte des articles — ${apply ? "import terminé" : "aperçu local"}`);
  console.log(`  graphId : ${result.graphId}`);
  for (const article of result.articles) {
    console.log(`  ${article.num ?? article.id} (${article.id}) : ${article.texte.length} caractères, SHA-256 ${article.texteSha256}`);
    console.log(`    source : ${article.normalizedPath} → ${article.texteSource}`);
  }
  if (result.result) {
    console.log(`  écrits : ${result.result.written} ; déjà présents : ${result.result.alreadyPresent}`);
    console.log(`  cible : ${result.endpointSummary}`);
  } else {
    console.log("  Aucune connexion ni écriture Neo4j.");
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

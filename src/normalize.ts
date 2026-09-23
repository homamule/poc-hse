import { normalizeCollection } from "./normalize/run.js";
import { isNormalizeError } from "./normalize/errors.js";

function parseArgs(argv: string[]): { collectionPath: string } {
  let collectionPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--collection") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(
          'Argument manquant : --collection "data/collections/<fichier>.json"',
        );
      }
      collectionPath = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--collection=")) {
      collectionPath = arg.slice("--collection=".length);
      continue;
    }
  }

  if (!collectionPath || collectionPath.trim() === "") {
    throw new Error(
      'Usage : npm run normalize -- --collection "data/collections/<fichier>.json"',
    );
  }

  return { collectionPath: collectionPath.trim() };
}

async function main(): Promise<void> {
  const { collectionPath } = parseArgs(process.argv.slice(2));

  console.log("Normalisation Légifrance — démarrage");
  console.log(`  Métadonnées : ${collectionPath}`);

  const result = await normalizeCollection({
    collectionMetaPath: collectionPath,
  });

  const { document } = result;

  console.log("");
  if (result.status === "already_normalized") {
    console.log("Déjà normalisé (contenu identique, aucune réécriture).");
  } else {
    console.log("Normalisation réussie");
  }

  console.log(`  collectionId     : ${document.provenance.collectionId}`);
  console.log(`  environment      : ${document.provenance.environment}`);
  console.log(`  article.id       : ${document.identity.id ?? "(null)"}`);
  console.log(`  article.cid      : ${document.identity.cid ?? "(null)"}`);
  console.log(`  num              : ${document.identity.num ?? "(null)"}`);
  console.log(`  etat (source)    : ${document.identity.etat ?? "(null)"}`);
  console.log(
    `  texte présent    : ${document.content.texte !== null ? "oui" : "non"}`,
  );
  console.log(
    `  texteHtml présent: ${document.content.texteHtml !== null ? "oui" : "non"}`,
  );
  console.log(`  avertissements   : ${document.warnings.length}`);
  for (const warning of document.warnings) {
    console.log(`    - [${warning.code}] ${warning.path}: ${warning.message}`);
  }
  console.log(`  fichier          : ${result.outputPathRelative}`);
}

main().catch((error: unknown) => {
  if (isNormalizeError(error)) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error("Aucun fichier normalisé n'a été produit.");
    process.exitCode = error.exitCode;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("");
  console.error(`ÉCHEC [USAGE_OR_UNEXPECTED] : ${message}`);
  console.error("Aucun fichier normalisé n'a été produit.");
  process.exitCode = 1;
});

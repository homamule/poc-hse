import { isCompareError } from "./compare/errors.js";
import { isNormalizeError } from "./normalize/errors.js";
import { isPublishError } from "./publish.js";
import { CompareError } from "./compare/errors.js";
import {
  runCompare,
  summarizeDifferencePaths,
} from "./compare/run.js";
import type { DiffCategory } from "./compare/types.js";

function parseArgs(argv: string[]): { before: string; after: string } {
  let before: string | undefined;
  let after: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--before") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new CompareError(
          "COMPARE_USAGE",
          'Argument manquant : --before "data/collections/<fichier>.json"',
        );
      }
      before = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--before=")) {
      before = arg.slice("--before=".length);
      continue;
    }
    if (arg === "--after") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new CompareError(
          "COMPARE_USAGE",
          'Argument manquant : --after "data/collections/<fichier>.json"',
        );
      }
      after = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--after=")) {
      after = arg.slice("--after=".length);
      continue;
    }
  }

  if (!before?.trim() || !after?.trim()) {
    throw new CompareError(
      "COMPARE_USAGE",
      'Usage : npm run compare -- --before "data/collections/<premiere>.json" --after "data/collections/<seconde>.json"',
    );
  }

  return { before: before.trim(), after: after.trim() };
}

const CATEGORY_ORDER: DiffCategory[] = [
  "content",
  "dates_state",
  "identity",
  "context",
  "versions",
  "relations",
  "technical",
  "other",
];

async function main(): Promise<void> {
  const { before, after } = parseArgs(process.argv.slice(2));

  console.log("Comparaison de collectes — démarrage");
  console.log(`  before : ${before}`);
  console.log(`  after  : ${after}`);

  const outcome = await runCompare({
    beforeMetaPath: before,
    afterMetaPath: after,
  });
  const { report } = outcome;

  console.log("");
  if (outcome.publishStatus === "already_identical") {
    console.log("Déjà comparé (rapport identique, aucune réécriture).");
  } else {
    console.log("Comparaison réussie");
  }
  console.log(`  articleId     : ${report.before.articleId}`);
  console.log(`  environnement : ${report.before.environment}`);
  console.log(`  before        : ${report.before.collectionId}`);
  console.log(`  after         : ${report.after.collectionId}`);
  console.log(`  statut        : ${report.status}`);
  console.log("  différences   :");
  for (const category of CATEGORY_ORDER) {
    const count = report.counters[category];
    if (count > 0) {
      console.log(`    - ${category}: ${count}`);
    }
  }
  console.log(`    - total: ${report.counters.total}`);

  const paths = summarizeDifferencePaths(report.differences);
  if (paths.length > 0) {
    console.log("  chemins :");
    for (const p of paths) {
      console.log(`    - ${p}`);
    }
  }
  console.log(`  rapport : ${outcome.reportPathRelative}`);

  process.exitCode = 0;
}

main().catch((error: unknown) => {
  if (
    isCompareError(error) ||
    isNormalizeError(error) ||
    isPublishError(error)
  ) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error("Aucun rapport de comparaison n'a été produit.");
    process.exitCode = error.exitCode;
    return;
  }

  console.error("");
  console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
  console.error("Aucun rapport de comparaison n'a été produit.");
  process.exitCode = 1;
});

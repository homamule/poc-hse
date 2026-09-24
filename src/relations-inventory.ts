import { isPublishError } from "./publish.js";
import { isRelationsError, RelationsError } from "./relations/errors.js";
import { runRelationInventory } from "./relations/run.js";
import {
  RELATION_FAMILIES,
  type RelationInventoryEntry,
  type ResolutionClass,
} from "./relations/types.js";

function parseArgs(argv: string[]): { batch: string } {
  let batch: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--batch") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new RelationsError(
          "RELATIONS_USAGE",
          'Argument manquant : --batch "data/batches/<batchId>.json"',
        );
      }
      batch = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--batch=")) {
      batch = arg.slice("--batch=".length);
      continue;
    }
  }

  if (!batch?.trim()) {
    throw new RelationsError(
      "RELATIONS_USAGE",
      'Usage : npm run relations:inventory -- --batch "data/batches/<batchId>.json"',
    );
  }

  return { batch: batch.trim() };
}

const RESOLUTION_ORDER: ResolutionClass[] = [
  "version_collectee",
  "autre_version_connue",
  "non_resolue",
];

function formatCollectedMatch(entry: RelationInventoryEntry): string {
  const target = entry.articleId ?? "(absent)";
  const num =
    entry.articleNum !== null && entry.articleNum !== ""
      ? ` (${entry.articleNum})`
      : "";
  return `${entry.source.articleId} → ${target}${num} [${entry.family}#${entry.index}]`;
}

async function main(): Promise<void> {
  const { batch } = parseArgs(process.argv.slice(2));

  console.log("Inventaire des relations — démarrage");
  console.log(`  batch : ${batch}`);

  const outcome = await runRelationInventory({ batchPath: batch });
  const { report } = outcome;

  console.log("");
  if (outcome.publishStatus === "already_identical") {
    console.log("Déjà présent (inventaire identique, aucune réécriture).");
  } else {
    console.log("Inventaire publié");
  }

  console.log(`  batchId     : ${report.batchId}`);
  console.log(`  inventoryId : ${report.inventoryId}`);
  console.log(`  total       : ${report.counters.total}`);
  console.log("  par famille :");
  for (const family of RELATION_FAMILIES) {
    console.log(`    - ${family}: ${report.counters.byFamily[family]}`);
  }
  console.log("  par classe  :");
  for (const cls of RESOLUTION_ORDER) {
    console.log(`    - ${cls}: ${report.counters.byResolution[cls]}`);
  }

  const collected = report.entries.filter(
    (e) => e.resolution.class === "version_collectee",
  );
  console.log(`  version_collectee (${collected.length}) :`);
  for (const entry of collected) {
    console.log(`    - ${formatCollectedMatch(entry)}`);
  }

  console.log(`  inventaire  : ${outcome.reportPathRelative}`);
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  if (isRelationsError(error) || isPublishError(error)) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error("Aucun inventaire n'a été produit.");
    process.exitCode = error.exitCode;
    return;
  }

  console.error("");
  console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
  console.error("Aucun inventaire n'a été produit.");
  process.exitCode = 1;
});

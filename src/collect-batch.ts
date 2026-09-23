import { CollectError, isCollectError } from "./errors.js";
import { isNormalizeError } from "./normalize/errors.js";
import { isPublishError } from "./publish.js";
import {
  formatBatchProgressLine,
  parseDelayMs,
  runBatch,
} from "./batch/run.js";

function parseArgs(argv: string[]): { inputPath: string; delayMs: number } {
  let inputPath: string | undefined;
  let delayRaw: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--input") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new CollectError(
          "BATCH_CONFIG_INVALID",
          'Argument manquant : --input "config/articles-pilot.json"',
        );
      }
      inputPath = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
      continue;
    }

    if (arg === "--delay-ms") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new CollectError(
          "BATCH_CONFIG_INVALID",
          "Argument manquant : --delay-ms <entier≥0>",
        );
      }
      delayRaw = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--delay-ms=")) {
      delayRaw = arg.slice("--delay-ms=".length);
      continue;
    }
  }

  if (!inputPath || inputPath.trim() === "") {
    throw new CollectError(
      "BATCH_CONFIG_INVALID",
      'Usage : npm run collect:batch -- --input "config/articles-pilot.json" [--delay-ms 1000]',
    );
  }

  return {
    inputPath: inputPath.trim(),
    delayMs: parseDelayMs(delayRaw),
  };
}

async function main(): Promise<void> {
  const { inputPath, delayMs } = parseArgs(process.argv.slice(2));

  console.log("Collecte par lot Légifrance — démarrage");
  console.log(`  Entrée   : ${inputPath}`);
  console.log(`  Délai    : ${delayMs} ms (réglage pilote, hors quota PISTE)`);
  console.log("");

  const outcome = await runBatch({
    inputPath,
    delayMs,
    onArticleResult: (event) => {
      console.log(formatBatchProgressLine(event));
    },
  });
  const { report } = outcome;

  console.log("");
  console.log(`Statut global : ${report.status}`);
  if (report.globalError) {
    console.log(
      `Erreur globale : [${report.globalError.step}/${report.globalError.code}] ${report.globalError.message}`,
    );
  }
  console.log("Compteurs :");
  console.log(`  requested     : ${report.counters.requested}`);
  console.log(`  collected     : ${report.counters.collected}`);
  console.log(`  normalized    : ${report.counters.normalized}`);
  console.log(`  failed        : ${report.counters.failed}`);
  console.log(`  notProcessed  : ${report.counters.notProcessed}`);
  console.log(`Rapport : ${outcome.reportPathRelative}`);

  process.exitCode = outcome.exitCode;
}

main().catch((error: unknown) => {
  if (
    isCollectError(error) ||
    isNormalizeError(error) ||
    isPublishError(error)
  ) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error(
      "Le lot n'a pas été mené à bien. Les collectes déjà sauvegardées, le cas échéant, sont conservées.",
    );
    process.exitCode = error.exitCode;
    return;
  }

  console.error("");
  console.error("ÉCHEC [UNEXPECTED] : erreur inattendue (détails non exposés).");
  process.exitCode = 1;
});

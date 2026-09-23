import path from "node:path";
import { loadConfig } from "./config.js";
import { fetchAccessToken } from "./auth.js";
import { fetchArticle } from "./legifrance.js";
import { saveSuccessfulCollection } from "./storage.js";
import { extractArticleSummary } from "./summary.js";
import { isCollectError } from "./errors.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("Collecte Légifrance — démarrage");
  console.log(`  Environnement : ${config.env}`);
  console.log(`  Identifiant demandé : ${config.articleId}`);
  console.log(`  Timeout HTTP : ${config.timeoutMs} ms`);

  const accessToken = await fetchAccessToken(config);
  const article = await fetchArticle(config, accessToken);
  const saved = await saveSuccessfulCollection({
    bodyText: article.bodyText,
    environment: config.env,
    requestedArticleId: config.articleId,
    url: article.url,
    httpStatus: article.httpStatus,
  });

  const summary = extractArticleSummary(article.bodyJson);

  console.log("");
  console.log("Collecte réussie");
  console.log(`  Identifiant (réponse) : ${summary.id ?? "(non fourni)"}`);
  console.log(`  Numéro d'article      : ${summary.num ?? "(non fourni)"}`);

  const versionEntries = Object.entries(summary.versionInfo);
  if (versionEntries.length === 0) {
    console.log("  Version                : (aucune information de version présente)");
  } else {
    console.log("  Informations de version :");
    for (const [key, value] of versionEntries) {
      console.log(`    - ${key}: ${String(value)}`);
    }
  }

  console.log(`  Identifiant de collecte : ${saved.collectionId}`);
  console.log("  Fichiers sauvegardés :");
  console.log(`    - Corps brut : ${path.relative(process.cwd(), saved.bodyPath)}`);
  if (saved.bodyAlreadyExisted) {
    console.log(
      `      (corps déjà présent pour SHA-256 ${saved.sha256} — pas de duplication)`,
    );
  } else {
    console.log(`      SHA-256 : ${saved.sha256}`);
  }
  console.log(
    `    - Métadonnées : ${path.relative(process.cwd(), saved.collectionMetaPath)}`,
  );
}

main().catch((error: unknown) => {
  if (isCollectError(error)) {
    console.error("");
    console.error(`ÉCHEC [${error.code}] : ${error.message}`);
    console.error("La collecte n'a pas été enregistrée comme réussie.");
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("");
  console.error(`ÉCHEC [UNEXPECTED] : ${message}`);
  console.error("La collecte n'a pas été enregistrée comme réussie.");
  process.exit(1);
});

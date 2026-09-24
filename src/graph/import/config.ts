import { config as loadDotenv } from "dotenv";
import { GraphError } from "../errors.js";

export type Neo4jImportConfig = {
  uri: string;
  user: string;
  password: string;
  database: string;
};

/**
 * Charge la config Neo4j uniquement pour --apply.
 * Ne doit jamais être appelée en mode aperçu.
 */
export function loadNeo4jImportConfig(
  env: NodeJS.ProcessEnv = process.env,
): Neo4jImportConfig {
  loadDotenv();

  const uri = env.HSE_NEO4J_URI?.trim();
  const user = env.HSE_NEO4J_USER?.trim();
  const password = env.HSE_NEO4J_PASSWORD;
  const database = env.HSE_NEO4J_DATABASE?.trim() || "neo4j";

  if (!uri) {
    throw new GraphError(
      "GRAPH_CONFIG",
      "Variable d'environnement manquante ou vide : HSE_NEO4J_URI.",
    );
  }
  if (!user) {
    throw new GraphError(
      "GRAPH_CONFIG",
      "Variable d'environnement manquante ou vide : HSE_NEO4J_USER.",
    );
  }
  if (password === undefined || password === "") {
    throw new GraphError(
      "GRAPH_CONFIG",
      "Variable d'environnement manquante ou vide : HSE_NEO4J_PASSWORD.",
    );
  }

  return { uri, user, password, database };
}

/**
 * Résumé sûr pour la console : jamais le mot de passe,
 * jamais l'URI complète si elle embarque des identifiants.
 */
export function safeNeo4jEndpointSummary(uri: string, database: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password) {
      return `scheme=${parsed.protocol.replace(":", "")} database=${database}`;
    }
    const host = parsed.host || "(hôte masqué)";
    return `scheme=${parsed.protocol.replace(":", "")} host=${host} database=${database}`;
  } catch {
    return `database=${database}`;
  }
}

import { GraphError } from "../errors.js";
import {
  loadNeo4jImportConfig,
  safeNeo4jEndpointSummary,
} from "./config.js";
import {
  buildImportPlan,
  buildImportPreview,
  type GraphImportPlan,
  type ImportPreview,
} from "./plan.js";
import {
  createNeo4jImportDriver,
  type ControlCounts,
  type GraphImportDriver,
} from "./neo4j.js";
import { loadAndValidateGraph } from "./validate.js";

export type GraphImportRunOptions = {
  graphPath: string;
  apply?: boolean;
  projectRoot?: string;
  /** Injection de tests uniquement. */
  createDriver?: (config: {
    uri: string;
    user: string;
    password: string;
    database: string;
  }) => GraphImportDriver;
  /** Injection de tests pour la config --apply. */
  loadConfig?: () => {
    uri: string;
    user: string;
    password: string;
    database: string;
  };
};

export type GraphImportPreviewOutcome = {
  mode: "preview";
  preview: ImportPreview;
  plan: GraphImportPlan;
};

export type GraphImportApplyOutcome = {
  mode: "apply";
  graphId: string;
  inventoryId: string;
  graphPath: string;
  database: string;
  endpointSummary: string;
  control: ControlCounts;
  plan: GraphImportPlan;
};

export type GraphImportRunOutcome =
  | GraphImportPreviewOutcome
  | GraphImportApplyOutcome;

/**
 * Import contrôlé : aperçu local (défaut) ou --apply Neo4j.
 */
export async function runGraphImport(
  options: GraphImportRunOptions,
): Promise<GraphImportRunOutcome> {
  const loaded = await loadAndValidateGraph({
    graphPath: options.graphPath,
    ...(options.projectRoot !== undefined
      ? { projectRoot: options.projectRoot }
      : {}),
  });
  const plan = buildImportPlan(loaded.graph);

  if (!options.apply) {
    return {
      mode: "preview",
      preview: buildImportPreview({
        graph: loaded.graph,
        graphPath: loaded.graphPathRelative,
        plan,
      }),
      plan,
    };
  }

  const config = (options.loadConfig ?? loadNeo4jImportConfig)();
  const createDriver = options.createDriver ?? createNeo4jImportDriver;
  const driver = createDriver(config);
  const endpointSummary = safeNeo4jEndpointSummary(
    config.uri,
    config.database,
  );

  try {
    await driver.verifyConnectivity();
    await driver.ensureConstraints();
    await driver.importGraph(plan);
    const control = await driver.readControlCounts(plan.graphId);

    if (
      control.collected !== plan.expectedCounts.collected ||
      control.historical !== plan.expectedCounts.historical ||
      control.relationSources !== plan.expectedCounts.relationSources ||
      control.links !== plan.expectedCounts.links
    ) {
      throw new GraphError(
        "GRAPH_IMPORT_VERIFY",
        `Comptes de contrôle Neo4j inattendus pour graphId (attendu ${plan.expectedCounts.collected}/${plan.expectedCounts.historical}/${plan.expectedCounts.relationSources}/${plan.expectedCounts.links}).`,
      );
    }

    return {
      mode: "apply",
      graphId: plan.graphId,
      inventoryId: plan.inventoryId,
      graphPath: loaded.graphPathRelative,
      database: driver.database,
      endpointSummary,
      control,
      plan,
    };
  } finally {
    await driver.close();
  }
}

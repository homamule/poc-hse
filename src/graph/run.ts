import path from "node:path";
import { getProjectRoot } from "../normalize/load.js";
import {
  isPublishError,
  publishExclusiveTextFile,
} from "../publish.js";
import { buildGraphDocument } from "./build.js";
import { GraphError } from "./errors.js";
import { loadInventoryForGraph } from "./load.js";
import type { GraphDocument } from "./types.js";

export type GraphBuildRunOptions = {
  inventoryPath: string;
  projectRoot?: string;
};

export type GraphBuildRunOutcome = {
  graph: GraphDocument;
  graphPathRelative: string;
  graphPathAbsolute: string;
  publishStatus: "written" | "already_identical";
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function serializeGraphDocument(graph: GraphDocument): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export async function writeGraphDocument(input: {
  graph: GraphDocument;
  projectRoot?: string;
}): Promise<{
  absolute: string;
  relative: string;
  publishStatus: "written" | "already_identical";
}> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const relative = `data/graphs/${input.graph.graphId}.json`;
  const absolute = path.join(projectRoot, relative);
  const content = serializeGraphDocument(input.graph);

  try {
    const published = await publishExclusiveTextFile({
      content,
      destinationAbsolute: absolute,
      destinationLabel: toPosix(relative),
    });
    return {
      absolute,
      relative: toPosix(relative),
      publishStatus:
        published.status === "already_identical"
          ? "already_identical"
          : "written",
    };
  } catch (error) {
    if (isPublishError(error)) {
      throw new GraphError(error.code, error.message, error.exitCode);
    }
    throw error;
  }
}

/**
 * Projection locale en graphe JSON à partir d'un inventaire de relations.
 * Aucun réseau, aucun Neo4j, aucun .env.
 */
export async function runGraphBuild(
  options: GraphBuildRunOptions,
): Promise<GraphBuildRunOutcome> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const loaded = await loadInventoryForGraph({
    inventoryPath: options.inventoryPath,
    projectRoot,
  });
  const graph = buildGraphDocument(loaded);
  const written = await writeGraphDocument({ graph, projectRoot });

  return {
    graph,
    graphPathRelative: written.relative,
    graphPathAbsolute: written.absolute,
    publishStatus: written.publishStatus,
  };
}

import path from "node:path";
import { getProjectRoot } from "../normalize/load.js";
import {
  isPublishError,
  publishExclusiveTextFile,
} from "../publish.js";
import { buildRelationInventory } from "./build.js";
import { RelationsError } from "./errors.js";
import { loadPreventionBatchCorpus } from "./load.js";
import type { RelationInventoryReport } from "./types.js";

export type RelationInventoryRunOptions = {
  batchPath: string;
  projectRoot?: string;
};

export type RelationInventoryRunOutcome = {
  report: RelationInventoryReport;
  reportPathRelative: string;
  reportPathAbsolute: string;
  publishStatus: "written" | "already_identical";
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function serializeRelationInventory(
  report: RelationInventoryReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeRelationInventory(input: {
  report: RelationInventoryReport;
  projectRoot?: string;
}): Promise<{
  absolute: string;
  relative: string;
  publishStatus: "written" | "already_identical";
}> {
  const projectRoot = input.projectRoot ?? getProjectRoot();
  const relative = `data/relation-inventories/${input.report.inventoryId}.json`;
  const absolute = path.join(projectRoot, relative);
  const content = serializeRelationInventory(input.report);

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
      throw new RelationsError(error.code, error.message, error.exitCode);
    }
    throw error;
  }
}

/**
 * Inventaire local des relations à partir d'un rapport de lot prévention.
 * Aucun réseau, aucun .env.
 */
export async function runRelationInventory(
  options: RelationInventoryRunOptions,
): Promise<RelationInventoryRunOutcome> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const loaded = await loadPreventionBatchCorpus({
    batchPath: options.batchPath,
    projectRoot,
  });
  const report = buildRelationInventory(loaded);
  const written = await writeRelationInventory({ report, projectRoot });

  return {
    report,
    reportPathRelative: written.relative,
    reportPathAbsolute: written.absolute,
    publishStatus: written.publishStatus,
  };
}

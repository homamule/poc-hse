import path from "node:path";
import { getProjectRoot } from "../normalize/load.js";
import {
  isPublishError,
  publishExclusiveTextFile,
} from "../publish.js";
import { CollectError } from "../errors.js";
import {
  BATCH_REPORT_SCHEMA_VERSION,
  type BatchReport,
} from "./types.js";

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function assertSafeBatchId(batchId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(batchId) || batchId.includes("..")) {
    throw new CollectError(
      "BATCH_REPORT_INVALID",
      "batchId invalide pour un nom de fichier.",
    );
  }
}

export function serializeBatchReport(report: BatchReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeBatchReport(input: {
  report: BatchReport;
  projectRoot?: string;
}): Promise<{ absolute: string; relative: string }> {
  assertSafeBatchId(input.report.batchId);
  if (input.report.schemaVersion !== BATCH_REPORT_SCHEMA_VERSION) {
    throw new CollectError(
      "BATCH_REPORT_INVALID",
      "schemaVersion du rapport invalide.",
    );
  }

  const projectRoot = input.projectRoot ?? getProjectRoot();
  const relative = `data/batches/${input.report.batchId}.json`;
  const absolute = path.join(projectRoot, relative);
  const content = serializeBatchReport(input.report);

  try {
    await publishExclusiveTextFile({
      content,
      destinationAbsolute: absolute,
      destinationLabel: relative,
    });
  } catch (error) {
    if (isPublishError(error)) {
      throw new CollectError(error.code, error.message, error.exitCode);
    }
    throw error;
  }

  return { absolute, relative: toPosix(relative) };
}

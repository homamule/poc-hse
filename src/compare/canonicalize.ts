import { createHash } from "node:crypto";
import { parsePointer, pathMatchesRoot } from "./pointer.js";
import {
  CATEGORY_ROOTS,
  TECHNICAL_PATHS,
  type DiffCategory,
} from "./types.js";

/**
 * Trie locale-indépendant : ordre des unités de code UTF-16 via < / >.
 */
export function compareStringsDeterministic(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Canonisation structurelle :
 * - tri récursif des clés d'objets ;
 * - préservation des tableaux et de toutes les valeurs ;
 * - Object.create(null) pour accepter "__proto__" etc. ;
 * - ne modifie pas la source.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort(compareStringsDeterministic);
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    out[key] = canonicalize(source[key]);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function structuralSha256(value: unknown): string {
  return sha256Utf8(stableStringify(value));
}

function deleteAtPointer(root: unknown, pointer: string): unknown {
  const segments = parsePointer(pointer);
  if (segments.length === 0) {
    return root;
  }

  const clone = structuredCloneSafe(root);
  let cursor: unknown = clone;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      !(segment in (cursor as Record<string, unknown>))
    ) {
      return clone;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  const last = segments[segments.length - 1]!;
  if (
    cursor !== null &&
    typeof cursor === "object" &&
    !Array.isArray(cursor) &&
    last in (cursor as Record<string, unknown>)
  ) {
    delete (cursor as Record<string, unknown>)[last];
  }
  return clone;
}

/**
 * structuredClone échoue sur Object.create(null) dans certains cas ;
 * on repasse par JSON pour un clone de données JSON pures.
 */
function structuredCloneSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * Retire uniquement les chemins technical listés (politique 1.0.0),
 * puis canonise. Tous les autres champs, y compris inconnus, restent.
 */
export function omitTechnicalPaths(value: unknown): unknown {
  let current = structuredCloneSafe(value);
  for (const pointer of TECHNICAL_PATHS) {
    current = deleteAtPointer(current, pointer);
  }
  return canonicalize(current);
}

export function watchSha256(value: unknown): string {
  return sha256Utf8(stableStringify(omitTechnicalPaths(value)));
}

export function classifyPath(path: string): DiffCategory {
  for (const technical of TECHNICAL_PATHS) {
    if (pathMatchesRoot(path, technical)) {
      return "technical";
    }
  }
  for (const group of CATEGORY_ROOTS) {
    for (const root of group.roots) {
      if (pathMatchesRoot(path, root)) {
        return group.category;
      }
    }
  }
  return "other";
}

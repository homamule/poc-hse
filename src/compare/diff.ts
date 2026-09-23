import { classifyPath } from "./canonicalize.js";
import { joinPointer } from "./pointer.js";
import type { DiffOperation, StructuralDifference } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameType(a: unknown, b: unknown): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b);
  }
  return typeof a === typeof b;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== "object") {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const bSet = new Set(bKeys);
  for (const key of aKeys) {
    if (!bSet.has(key)) {
      return false;
    }
    if (!deepEqual(aObj[key], bObj[key])) {
      return false;
    }
  }
  return true;
}

function pushDiff(
  out: StructuralDifference[],
  path: string,
  operation: DiffOperation,
  beforePresent: boolean,
  afterPresent: boolean,
  before: unknown,
  after: unknown,
): void {
  const entry: StructuralDifference = {
    path,
    operation,
    beforePresent,
    afterPresent,
    category: classifyPath(path),
  };
  if (beforePresent) {
    entry.before = before;
  }
  if (afterPresent) {
    entry.after = after;
  }
  out.push(entry);
}

/**
 * Diff structurelle exhaustive.
 * Ordre des clés d'objets ignoré ; ordre et doublons des tableaux conservés.
 * Si un tableau diffère : une seule différence sur le tableau complet.
 */
export function diffJson(
  before: unknown,
  after: unknown,
  path = "",
): StructuralDifference[] {
  const out: StructuralDifference[] = [];
  diffInto(before, after, path, out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function diffInto(
  before: unknown,
  after: unknown,
  path: string,
  out: StructuralDifference[],
): void {
  const beforePresent = before !== undefined;
  const afterPresent = after !== undefined;

  if (!beforePresent && !afterPresent) {
    return;
  }
  if (!beforePresent && afterPresent) {
    pushDiff(out, path || "", "added", false, true, undefined, after);
    return;
  }
  if (beforePresent && !afterPresent) {
    pushDiff(out, path || "", "removed", true, false, before, undefined);
    return;
  }

  // Les deux présents (y compris null).
  if (!sameType(before, after)) {
    pushDiff(out, path || "", "replaced", true, true, before, after);
    return;
  }

  if (before === null && after === null) {
    return;
  }

  if (typeof before !== "object" || before === null) {
    // scalaire (string, number, boolean) — comparaison exacte, pas de trim
    if (!Object.is(before, after)) {
      pushDiff(out, path || "", "replaced", true, true, before, after);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (!deepEqual(before, after)) {
      pushDiff(out, path || "", "replaced", true, true, before, after);
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const key of sorted) {
      const childPath = joinPointer(path, key);
      const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
      const afterHas = Object.prototype.hasOwnProperty.call(after, key);
      diffInto(
        beforeHas ? before[key] : undefined,
        afterHas ? after[key] : undefined,
        childPath,
        out,
      );
    }
  }
}

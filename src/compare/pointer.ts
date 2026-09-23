/**
 * JSON Pointer (RFC 6901) : échappement ~0 / ~1.
 */

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function joinPointer(parent: string, segment: string): string {
  return `${parent}/${escapePointerSegment(segment)}`;
}

export function parsePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer invalide : ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => unescapePointerSegment(segment));
}

/**
 * true si `path` est exactement `root` ou un descendant (par segments),
 * sans correspondance accidentelle par préfixe de chaîne.
 */
export function pathMatchesRoot(path: string, root: string): boolean {
  if (path === root) {
    return true;
  }
  return path.startsWith(`${root}/`);
}

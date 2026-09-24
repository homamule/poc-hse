import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getProjectRoot } from "../../normalize/load.js";
import { isPublishError, publishExclusiveTextFile } from "../../publish.js";
import { runGraphContent, type ArticleContent } from "../content/run.js";
import { GraphError } from "../errors.js";

export const PASSAGE_POLICY_VERSION = "1.0.0" as const;

export type Passage = {
  id: string;
  articleId: string;
  index: number;
  start: number;
  end: number;
  texte: string;
  texteSha256: string;
};

export type PassageDocument = {
  schemaVersion: 1;
  passagePolicyVersion: typeof PASSAGE_POLICY_VERSION;
  passageSetId: string;
  graphId: string;
  articles: Array<{
    id: string;
    num: string | null;
    collectionId: string;
    bodySha256: string;
    normalizedPath: string;
    articleTexteSha256: string;
    passages: Passage[];
  }>;
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function decodeEntities(source: string): string {
  return source.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (full, entity: string) => {
    const named: Record<string, string> = {
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
    };
    const value = entity.startsWith("#x") || entity.startsWith("#X")
      ? Number.parseInt(entity.slice(2), 16)
      : entity.startsWith("#") ? Number.parseInt(entity.slice(1), 10) : null;
    if (value !== null) {
      if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
        throw new GraphError("PASSAGE_INPUT_INVALID", "Entité HTML numérique invalide.");
      }
      return String.fromCodePoint(value);
    }
    const decoded = named[entity.toLowerCase()];
    if (decoded === undefined) {
      throw new GraphError("PASSAGE_INPUT_INVALID", `Entité HTML non prise en charge : ${full}.`);
    }
    return decoded;
  });
}

/** Le HTML donne seulement les frontières ; les passages restent des sous-chaînes exactes du texte brut. */
export function splitAtHtmlParagraphs(article: ArticleContent, html: string): Passage[] {
  const htmlParagraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)]
    .map((match) => decodeEntities((match[1] ?? "").replace(/<[^>]*>/g, "")))
    .filter((content) => content.trim().length > 0);
  if (htmlParagraphs.length === 0) {
    throw new GraphError("PASSAGE_INPUT_INVALID", `Paragraphes HTML absents : ${article.id}.`);
  }
  const passages: Passage[] = [];
  let cursor = 0;
  for (const content of htmlParagraphs) {
    const start = cursor;
    for (const char of content) {
      if (/\s/u.test(char)) continue;
      while (cursor < article.texte.length && /\s/u.test(article.texte[cursor]!)) cursor++;
      const raw = article.texte.codePointAt(cursor);
      if (raw === undefined || String.fromCodePoint(raw) !== char) {
        throw new GraphError("PASSAGE_INPUT_INVALID", `HTML et texte brut divergents : ${article.id}.`);
      }
      cursor += raw > 0xffff ? 2 : 1;
    }
    while (cursor < article.texte.length && /\s/u.test(article.texte[cursor]!)) cursor++;
    const texte = article.texte.slice(start, cursor);
    if (texte.trim().length === 0) continue;
    const index = passages.length;
    const texteSha256 = digest(texte);
    passages.push({
      id: digest(JSON.stringify([PASSAGE_POLICY_VERSION, article.key, index, texteSha256])),
      articleId: article.id, index, start, end: cursor, texte, texteSha256,
    });
  }
  if (cursor !== article.texte.length || passages.map((p) => p.texte).join("") !== article.texte) {
    throw new GraphError("PASSAGE_INPUT_INVALID", `Paragraphes incomplets : ${article.id}.`);
  }
  return passages;
}

export async function runGraphPassages(options: {
  graphPath: string; projectRoot?: string;
}): Promise<{
  document: PassageDocument; path: string; publishStatus: "written" | "already_identical";
}> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const content = await runGraphContent({ graphPath: options.graphPath, projectRoot });
  const articles: PassageDocument["articles"] = [];
  for (const article of content.articles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(projectRoot, article.normalizedPath), "utf8")) as unknown;
    } catch {
      throw new GraphError("PASSAGE_INPUT_INVALID", `Document normalisé illisible : ${article.id}.`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        !("content" in parsed) || typeof parsed.content !== "object" || parsed.content === null ||
        !("texte" in parsed.content) || parsed.content.texte !== article.texte ||
        !("texteHtml" in parsed.content) || typeof parsed.content.texteHtml !== "string") {
      throw new GraphError("PASSAGE_INPUT_INVALID", `Texte HTML ou provenance absente : ${article.id}.`);
    }
    articles.push({
      id: article.id, num: article.num, collectionId: article.collectionId,
      bodySha256: article.bodySha256, normalizedPath: article.normalizedPath,
      articleTexteSha256: article.texteSha256,
      passages: splitAtHtmlParagraphs(article, parsed.content.texteHtml),
    });
  }
  const base = { schemaVersion: 1 as const, passagePolicyVersion: PASSAGE_POLICY_VERSION,
    graphId: content.graphId, articles };
  const passageSetId = digest(JSON.stringify(base));
  const document: PassageDocument = { ...base, passageSetId };
  const relative = `data/passages/${passageSetId}.json`;
  try {
    const published = await publishExclusiveTextFile({
      content: `${JSON.stringify(document, null, 2)}\n`,
      destinationAbsolute: path.join(projectRoot, relative),
      destinationLabel: relative,
    });
    return { document, path: relative,
      publishStatus: published.status === "already_identical" ? "already_identical" : "written" };
  } catch (error) {
    if (isPublishError(error)) throw new GraphError(error.code, error.message, error.exitCode);
    throw error;
  }
}

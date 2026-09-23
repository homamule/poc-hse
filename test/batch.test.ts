import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBatchInput } from "../src/batch/input.js";
import { parseDelayMs, runBatch } from "../src/batch/run.js";
import type { OAuthConfig } from "../src/config.js";
import { isCollectError } from "../src/errors.js";
import { NormalizeError } from "../src/normalize/errors.js";
import type { BatchReport } from "../src/batch/types.js";

const ID_A = "LEGIARTI000035640828";
const ID_B = "LEGIARTI000023032086";
const ID_C = "LEGIARTI000006903147";

function oauthConfig(): OAuthConfig {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret-never-log",
    env: "sandbox",
    timeoutMs: 5_000,
    oauthTokenUrl: "https://oauth.test/token",
    getArticleUrl: "https://api.test/consult/getArticle",
  };
}

function articleBody(id: string): string {
  return `${JSON.stringify({
    article: {
      id,
      cid: "LEGIARTI000006903147",
      num: "L4121-1",
      texte: `Texte de ${id}`,
      texteHtml: `<p>Texte de ${id}</p>`,
      etat: "VIGUEUR",
      dateDebut: 1506816000000,
      dateFin: 32472144000000,
      idTexte: null,
      cidTexte: null,
      articleVersions: [],
      lienCitations: [],
      lienModifications: [],
      lienConcordes: [],
      lienAutres: [],
    },
  })}\n`;
}

async function writeInput(
  projectRoot: string,
  articleIds: string[],
): Promise<string> {
  const configDir = path.join(projectRoot, "config");
  await mkdir(configDir, { recursive: true });
  const rel = "config/articles-pilot.json";
  await writeFile(
    path.join(projectRoot, rel),
    `${JSON.stringify({ schemaVersion: 1, articleIds }, null, 2)}\n`,
    "utf8",
  );
  return rel;
}

function installFetch(handlers: {
  onToken?: () => Response;
  onArticle: (id: string) => Response;
}): {
  restore: () => void;
  getTokenCalls: () => number;
  articleOrder: string[];
} {
  const previous = globalThis.fetch;
  let tokenCalls = 0;
  const articleOrder: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/token")) {
      tokenCalls += 1;
      if (handlers.onToken) {
        return handlers.onToken();
      }
      return new Response(
        JSON.stringify({
          access_token: "opaque-batch-token",
          token_type: "Bearer",
        }),
        { status: 200 },
      );
    }
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as { id: string })
        : { id: "?" };
    articleOrder.push(body.id);
    return handlers.onArticle(body.id);
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = previous;
    },
    getTokenCalls: () => tokenCalls,
    articleOrder,
  };
}

describe("parseBatchInput", () => {
  it("rejette les doublons sans correction silencieuse", () => {
    assert.throws(
      () =>
        parseBatchInput({
          schemaVersion: 1,
          articleIds: [ID_A, ID_A],
        }),
      (error: unknown) =>
        isCollectError(error) &&
        error.code === "BATCH_INPUT_INVALID" &&
        /Doublon/.test(error.message),
    );
  });

  it("rejette un identifiant mal formé", () => {
    assert.throws(
      () =>
        parseBatchInput({
          schemaVersion: 1,
          articleIds: ["NOT_AN_ID"],
        }),
      (error: unknown) =>
        isCollectError(error) && error.code === "BATCH_INPUT_INVALID",
    );
  });
});

describe("parseDelayMs", () => {
  it("accepte 0 et les entiers positifs", () => {
    assert.equal(parseDelayMs("0"), 0);
    assert.equal(parseDelayMs("1000"), 1000);
    assert.equal(parseDelayMs(undefined), 1000);
  });

  it("rejette les valeurs invalides", () => {
    assert.throws(() => parseDelayMs("-1"));
    assert.throws(() => parseDelayMs("1.5"));
  });
});

describe("runBatch", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  async function freshRoot(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "graphrag-batch-"));
    cleanups.push(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });
    return projectRoot;
  }

  it("entrée invalide ou doublonnée : aucun appel réseau", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_A]);
    let fetchCalled = false;
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          runBatch({
            inputPath,
            projectRoot,
            oauthConfig: oauthConfig(),
            delayMs: 0,
            sleep: async () => undefined,
          }),
        (error: unknown) =>
          isCollectError(error) && error.code === "BATCH_INPUT_INVALID",
      );
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("commande batch sans LEGIFRANCE_ARTICLE_ID", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A]);
    const previousId = process.env.LEGIFRANCE_ARTICLE_ID;
    delete process.env.LEGIFRANCE_ARTICLE_ID;

    const mock = installFetch({
      onArticle: (id) => new Response(articleBody(id), { status: 200 }),
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-no-article-env-0001",
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(outcome.report.counters.normalized, 1);
      assert.equal(process.env.LEGIFRANCE_ARTICLE_ID, undefined);
    } finally {
      mock.restore();
      if (previousId !== undefined) {
        process.env.LEGIFRANCE_ARTICLE_ID = previousId;
      } else {
        delete process.env.LEGIFRANCE_ARTICLE_ID;
      }
    }
  });

  it("ordre séquentiel, un seul OAuth, lot réussi et rapport cohérent", async () => {
    const projectRoot = await freshRoot();
    const ids = [ID_A, ID_B, ID_C];
    const inputPath = await writeInput(projectRoot, ids);
    const delays: number[] = [];
    const mock = installFetch({
      onArticle: (id) => new Response(articleBody(id), { status: 200 }),
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 7,
        sleep: async (ms) => {
          delays.push(ms);
        },
        createBatchId: () => "batch-success-000000000001",
      });

      assert.equal(mock.getTokenCalls(), 1);
      assert.deepEqual(mock.articleOrder, ids);
      assert.deepEqual(delays, [7, 7]);
      assert.equal(outcome.exitCode, 0);
      assert.equal(outcome.report.status, "completed");
      assert.deepEqual(outcome.report.counters, {
        requested: 3,
        collected: 3,
        normalized: 3,
        failed: 0,
        notProcessed: 0,
      });

      const reportText = await readFile(
        path.join(projectRoot, outcome.reportPathRelative),
        "utf8",
      );
      assert.doesNotMatch(reportText, /test-client-secret/);
      assert.doesNotMatch(reportText, /opaque-batch-token/);
      const report = JSON.parse(reportText) as BatchReport;
      assert.equal(
        report.results.every((r) => r.status === "success"),
        true,
      );
    } finally {
      mock.restore();
    }
  });

  it("article introuvable ou réponse invalide : poursuite", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B, ID_C]);
    const mock = installFetch({
      onArticle: (id) => {
        if (id === ID_B) {
          return new Response("{}", { status: 404 });
        }
        if (id === ID_C) {
          return new Response(JSON.stringify({ article: {} }), { status: 200 });
        }
        return new Response(articleBody(id), { status: 200 });
      },
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-continue-00000000001",
      });
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.report.status, "completed_with_errors");
      assert.equal(outcome.report.results[0]?.status, "success");
      assert.equal(outcome.report.results[1]?.errorCode, "NOT_FOUND");
      assert.equal(outcome.report.results[2]?.errorCode, "INVALID_RESPONSE");
      assert.equal(outcome.report.counters.notProcessed, 0);
      assert.equal(outcome.report.counters.failed, 2);
      assert.equal(outcome.report.counters.normalized, 1);
    } finally {
      mock.restore();
    }
  });

  it("quota : arrêt et reste non traité", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B, ID_C]);
    const mock = installFetch({
      onArticle: (id) => {
        if (id === ID_B) {
          return new Response("{}", { status: 429 });
        }
        return new Response(articleBody(id), { status: 200 });
      },
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-quota-00000000000001",
      });
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.report.status, "aborted");
      assert.equal(outcome.report.results[0]?.status, "success");
      assert.equal(outcome.report.results[1]?.errorCode, "QUOTA");
      assert.equal(outcome.report.results[2]?.status, "not_processed");
      assert.equal(outcome.report.results[2]?.errorCode, undefined);
      assert.equal(outcome.report.counters.notProcessed, 1);
    } finally {
      mock.restore();
    }
  });

  it("échec OAuth initial : bilan arrêté", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B]);
    const mock = installFetch({
      onToken: () =>
        new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 400,
        }),
      onArticle: () => new Response("{}", { status: 500 }),
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-oauthfail-0000000001",
      });
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.report.status, "aborted");
      assert.equal(outcome.report.globalError?.step, "oauth");
      assert.equal(outcome.report.counters.notProcessed, 2);
      assert.equal(outcome.report.counters.collected, 0);
      assert.equal(mock.articleOrder.length, 0);
      const text = await readFile(
        path.join(projectRoot, outcome.reportPathRelative),
        "utf8",
      );
      assert.doesNotMatch(text, /test-client-secret/);
      assert.doesNotMatch(text, /opaque-batch-token/);
    } finally {
      mock.restore();
    }
  });

  it("échec de normalisation après sauvegarde : collecte conservée, lot arrêté", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B]);
    const mock = installFetch({
      onArticle: (id) => new Response(articleBody(id), { status: 200 }),
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-normfail-00000000001",
        normalize: async () => {
          throw new NormalizeError(
            "HASH_MISMATCH",
            "SHA-256 du corps recalculé ne correspond pas (simulé).",
          );
        },
      });

      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.report.status, "aborted");
      assert.equal(outcome.report.results[0]?.status, "failed");
      assert.equal(outcome.report.results[0]?.step, "normalization");
      assert.ok(outcome.report.results[0]?.collectionId);
      assert.ok(outcome.report.results[0]?.collectionMetaPath);
      assert.equal(outcome.report.results[0]?.normalizedPath, undefined);
      assert.equal(outcome.report.counters.collected, 1);
      assert.equal(outcome.report.counters.normalized, 0);
      assert.equal(outcome.report.counters.failed, 1);
      assert.equal(outcome.report.results[1]?.status, "not_processed");

      const metaPath = path.join(
        projectRoot,
        outcome.report.results[0]!.collectionMetaPath!,
      );
      await access(metaPath);
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
        collectionId: string;
      };
      assert.equal(meta.collectionId, outcome.report.results[0]?.collectionId);
    } finally {
      mock.restore();
    }
  });

  it("échec de stockage : arrêt", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B]);
    const mock = installFetch({
      onArticle: (id) => new Response(articleBody(id), { status: 200 }),
    });

    await mkdir(path.join(projectRoot, "data"), { recursive: true });
    await writeFile(path.join(projectRoot, "data", "bodies"), "not-a-dir", "utf8");

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-storagefail-000000001",
      });
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.report.status, "aborted");
      assert.equal(outcome.report.results[0]?.step, "storage");
      assert.equal(outcome.report.results[0]?.status, "failed");
      assert.equal(outcome.report.results[1]?.status, "not_processed");
      assert.equal(outcome.report.globalError?.step, "storage");
    } finally {
      mock.restore();
    }
  });

  it("auth : arrêt", async () => {
    const projectRoot = await freshRoot();
    const inputPath = await writeInput(projectRoot, [ID_A, ID_B]);
    const mock = installFetch({
      onArticle: () => new Response("{}", { status: 401 }),
    });

    try {
      const outcome = await runBatch({
        inputPath,
        projectRoot,
        oauthConfig: oauthConfig(),
        delayMs: 0,
        sleep: async () => undefined,
        createBatchId: () => "batch-auth-000000000000001",
      });
      assert.equal(outcome.report.status, "aborted");
      assert.equal(outcome.report.results[0]?.errorCode, "AUTH");
      assert.equal(outcome.report.results[1]?.status, "not_processed");
      assert.equal(outcome.exitCode, 1);
    } finally {
      mock.restore();
    }
  });
});

describe("régression collect/normalize config", () => {
  it("sépare OAuth commun et identifiant d'article unitaire", async () => {
    const { configForArticle, loadOAuthConfig } = await import("../src/config.js");
    const oauth = loadOAuthConfig();
    assert.equal("articleId" in oauth, false);
    assert.ok(oauth.oauthTokenUrl.length > 0);
    assert.ok(oauth.getArticleUrl.length > 0);

    const full = configForArticle(oauth, ID_A);
    assert.equal(full.articleId, ID_A);
    assert.equal(full.clientId, oauth.clientId);
    assert.equal(full.getArticleUrl, oauth.getArticleUrl);
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { checkClaim, liveAvailable, loadRegistry } from "./claims/check.ts";
import { staleDemo } from "./demo.ts";
import { freshnessScore } from "./freshness.ts";
import { pendingReview } from "./review.ts";
import { classify } from "./routing/classify.ts";
import { evaluateRouting, loadEvalSet, loadLatestQualityReport } from "./routing/eval.ts";
import type { ClassifyInput } from "./routing/text.ts";
import { loadVersions } from "./store.ts";

// Large enough for a full chat request: the gateway sends whole OpenAI bodies to /route/classify.
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJSON(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { ok: true, model: Boolean(process.env.EXTRACTION_MODEL), live_sources: liveAvailable() });
  }

  if (req.method === "GET" && path === "/registry") {
    const { entries, registry_hash } = await loadRegistry();
    const latest = (await loadVersions()).at(-1);
    const now = new Date();
    return send(res, 200, {
      version: latest?.version ?? null,
      published_at: latest?.created_at ?? null,
      registry_hash,
      entries: entries.map((e) => ({ ...e, freshness_score: freshnessScore(e.source_date, now) })),
    });
  }

  // Before /registry/:id, which would read "candidates" as a factor name.
  if (req.method === "GET" && path === "/registry/candidates") {
    return send(res, 200, { groups: await pendingReview() });
  }

  const factor = /^\/registry\/([a-z0-9-]+)$/.exec(path);
  if (req.method === "GET" && factor) {
    const { entries } = await loadRegistry();
    const entry = entries.find((e) => e.factor_id === factor[1]);
    if (!entry) throw new HttpError(404, `No registry entry ${factor[1]}`);
    return send(res, 200, { ...entry, freshness_score: freshnessScore(entry.source_date) });
  }

  if (req.method === "POST" && path === "/claims/check") {
    const body = (await readJSON(req)) as { claim?: unknown };
    if (typeof body?.claim !== "string") throw new HttpError(400, 'Body must be {"claim": "..."}');
    try {
      const { result, warnings } = await checkClaim(body.claim);
      for (const w of warnings) console.warn(`[claims] ${w}`);
      return send(res, 200, result);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }

  if (req.method === "POST" && path === "/route/classify") {
    const body = (await readJSON(req)) as ClassifyInput & { min_confidence?: unknown };
    if (!body || typeof body !== "object") throw new HttpError(400, "Body must be a JSON object");
    const minConfidence = typeof body.min_confidence === "number" ? body.min_confidence : undefined;
    try {
      return send(res, 200, classify(body, { minConfidence }));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }

  if (req.method === "GET" && path === "/eval/routing") {
    return send(res, 200, evaluateRouting(await loadEvalSet()));
  }

  if (req.method === "GET" && path === "/demo/stale-factor") {
    const result = await staleDemo({ live: url.searchParams.get("live") === "1" });
    if (result.warning) console.warn(`[demo] ${result.warning}`);
    return send(res, 200, result);
  }

  if (req.method === "GET" && path === "/eval/quality") {
    const report = await loadLatestQualityReport();
    if (!report) throw new HttpError(404, "No quality run yet: run `npm run eval -- quality` with Bifrost up");
    return send(res, 200, report);
  }

  throw new HttpError(404, `No route ${req.method} ${path}`);
}

export function createApiServer(): Server {
  const origin = process.env.DASHBOARD_ORIGIN || "*";
  return createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? "Internal error" : (err as Error).message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  createApiServer().listen(port, () => console.log(`Dropwise intelligence API on http://localhost:${port}`));
}

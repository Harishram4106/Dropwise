// Dropwise gateway: an OpenAI-compatible endpoint in front of Bifrost, plus the API the dashboard reads.
//
//   POST /v1/chat/completions   point your app here instead of at Bifrost
//   GET  /health                 what is configured and reachable
//   GET  /receipts               ?limit=50&virtual_key=&cache=hit|miss|bypass|skipped|off
//   GET  /receipts/:id
//   GET  /summary                ?scope=direct_only|direct_plus_indirect&virtual_key=
//   GET  /budgets                every key's budget state and the alerts raised
//   GET  /events                 server-sent events: "receipt", "budget_alert" and "job"
//   GET  /benchmark/latest       latest before/after benchmark (404 before the first run)
//
// Time shifting: send a request with  x-dropwise-defer: 6h  (or 90m, or an ISO deadline) and it is queued for the
// lowest-impact hour before then, instead of answered at once.
//   GET  /jobs                   deferred requests, newest first
//   GET  /jobs/profile           the hourly profile they are scheduled against (or null)
//   GET  /jobs/:id               one job; its answer is in `result` once it has run
//   POST /jobs/:id/run           run a scheduled job now instead of at its hour

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Budgets } from "./budgets.ts";
import { ResponseCache } from "./cache.ts";
import { type GatewayConfig, loadConfig } from "./config.ts";
import { IntelligenceClient } from "./intelligence.ts";
import { JobStore } from "./jobs.ts";
import { type Deps, handleChat, ProxyError } from "./proxy.ts";
import { ReceiptStore } from "./receipts.ts";
import { runJob, startScheduler } from "./scheduler.ts";
import type { Scope } from "./types.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJSON(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ProxyError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ProxyError(400, "Body must be a JSON object");
  }
}

export async function createDeps(config: GatewayConfig = loadConfig()): Promise<Deps> {
  const budgets = new Budgets(config.budgetsFile, join(config.dataDir, "usage.json"), config.scope);
  const receipts = new ReceiptStore(join(config.dataDir, "receipts.jsonl"));
  const jobs = new JobStore(config.jobsFile, config.hourlyProfileFile);
  await Promise.all([budgets.load(), receipts.load(), jobs.load()]);
  if (jobs.profileError) console.warn(`[gateway] ${jobs.profileError}`);
  return { config, intelligence: new IntelligenceClient(config.intelligenceUrl), cache: new ResponseCache(config.cacheTtlMs), budgets, receipts, jobs };
}

function events(deps: Deps, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  const onReceipt = (r: unknown) => res.write(`event: receipt\ndata: ${JSON.stringify(r)}\n\n`);
  const onAlert = (a: unknown) => res.write(`event: budget_alert\ndata: ${JSON.stringify(a)}\n\n`);
  const onJob = (j: unknown) => res.write(`event: job\ndata: ${JSON.stringify(j)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  deps.receipts.events.on("receipt", onReceipt);
  deps.receipts.events.on("budget_alert", onAlert);
  deps.jobs.events.on("job", onJob);
  req.on("close", () => {
    clearInterval(ping);
    deps.receipts.events.off("receipt", onReceipt);
    deps.receipts.events.off("budget_alert", onAlert);
    deps.jobs.events.off("job", onJob);
  });
}

async function route(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const q = (name: string) => url.searchParams.get(name) ?? undefined;

  if (req.method === "POST" && path === "/v1/chat/completions") {
    return handleChat(deps, await readJSON(req), req.headers, res);
  }

  if (req.method === "GET" && path === "/health") {
    const { config } = deps;
    return send(res, 200, {
      ok: true,
      bifrost_url: config.bifrostUrl,
      intelligence: await deps.intelligence.reachable(),
      routing: config.routing,
      cache: config.cache,
      small_model: config.smallModel,
      large_model: config.largeModel,
      scope: config.scope,
    });
  }

  if (req.method === "GET" && path === "/receipts") {
    const limit = Math.min(500, Math.max(1, Number(q("limit") ?? 50) || 50));
    return send(res, 200, deps.receipts.list({ limit, virtual_key: q("virtual_key"), cache: q("cache") }));
  }

  const one = /^\/receipts\/([A-Za-z0-9_-]+)$/.exec(path);
  if (req.method === "GET" && one) {
    const receipt = deps.receipts.get(one[1]);
    if (!receipt) throw new ProxyError(404, `No receipt ${one[1]}`);
    return send(res, 200, receipt);
  }

  if (req.method === "GET" && path === "/summary") {
    const scope: Scope = q("scope") === "direct_only" ? "direct_only" : q("scope") === "direct_plus_indirect" ? "direct_plus_indirect" : deps.config.scope;
    return send(res, 200, deps.receipts.summary(scope, q("virtual_key")));
  }

  if (req.method === "GET" && path === "/budgets") {
    return send(res, 200, { period: deps.budgets.config.period, budgets: deps.budgets.all(), alerts: deps.budgets.alerts.slice(-50) });
  }

  if (req.method === "GET" && path === "/events") return events(deps, req, res);

  if (req.method === "GET" && path === "/jobs") {
    const limit = Math.min(500, Math.max(1, Number(q("limit") ?? 100) || 100));
    return send(res, 200, deps.jobs.list(limit));
  }
  if (req.method === "GET" && path === "/jobs/profile") return send(res, 200, { profile: deps.jobs.profile, error: deps.jobs.profileError });
  const job = /^\/jobs\/(job_[A-Za-z0-9]+)(\/run)?$/.exec(path);
  if (job && req.method === "GET" && !job[2]) {
    const found = deps.jobs.get(job[1]);
    if (!found) throw new ProxyError(404, `No job ${job[1]}`);
    return send(res, 200, found);
  }
  if (job && req.method === "POST" && job[2]) {
    if (!deps.jobs.get(job[1])) throw new ProxyError(404, `No job ${job[1]}`);
    await deps.jobs.runEarly(job[1]);
    await runJob(deps, job[1]);
    return send(res, 200, deps.jobs.get(job[1]));
  }

  if (req.method === "GET" && path === "/benchmark/latest") {
    try {
      return send(res, 200, JSON.parse(await readFile(join(deps.config.dataDir, "benchmark", "latest.json"), "utf8")));
    } catch {
      throw new ProxyError(404, "No benchmark run yet");
    }
  }

  throw new ProxyError(404, `No route ${req.method} ${path}`);
}

export function createGatewayServer(deps: Deps): Server {
  return createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", deps.config.dashboardOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-bf-vk, x-dropwise-key, x-dropwise-defer");
    res.setHeader("Access-Control-Expose-Headers", "x-dropwise-request-id, x-dropwise-routed-to, x-dropwise-cache, x-dropwise-water-ml, x-dropwise-budget, x-dropwise-job-id, x-dropwise-scheduled-for");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    try {
      await route(deps, req, res);
    } catch (err) {
      const status = err instanceof ProxyError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return void res.end();
      send(res, status, { error: status === 500 ? "Internal error" : (err as Error).message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = await createDeps();
  const { config } = deps;
  createGatewayServer(deps).listen(config.port, () => {
    console.log(`Dropwise gateway on http://localhost:${config.port} -> Bifrost ${config.bifrostUrl}, intelligence ${config.intelligenceUrl}`);
    console.log(`routing ${config.routing ? "on" : "off"} (${config.largeModel} -> ${config.smallModel}), cache ${config.cache ? "on" : "off"}, scope ${config.scope}`);
    const p = deps.jobs.profile;
    console.log(
      p
        ? `time shifting on: hourly profile "${p.name}" (${p.timezone})${p.illustrative ? ", ILLUSTRATIVE, not measured" : ""}; ${deps.jobs.list().filter((j) => j.status === "scheduled").length} job(s) scheduled`
        : "time shifting: no hourly profile, so deferred requests run immediately (add data/hourly-profile.json)",
    );
  });
  startScheduler(deps);
}

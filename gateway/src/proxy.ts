// The gateway's request path, for every OpenAI-compatible chat request:
//   1. classify      intelligence API -> small or large, and whether the prompt is time-sensitive
//   2. route         an easy prompt asked of LARGE_MODEL (or "dropwise/auto") goes to SMALL_MODEL
//   3. cache         a repeat prompt is answered from cache; a time-sensitive one always skips it
//   4. forward       to Bifrost, which calls the provider
//   5. estimate      water range from tokens and signed registry factors
//   6. budget        add the range to the caller's virtual key, alert at 80% and 100%
//   7. receipt       stored, streamed to the dashboard, and summarized in response headers

import { randomUUID } from "node:crypto";
import { Budgets } from "./budgets.ts";
import { cacheable, cacheKey, type ChatBody, ResponseCache } from "./cache.ts";
import type { GatewayConfig } from "./config.ts";
import { estimate, METHOD } from "./estimator.ts";
import { IntelligenceClient } from "./intelligence.ts";
import { type DeferredInfo, type JobStore, parseDeadline } from "./jobs.ts";
import { ReceiptStore } from "./receipts.ts";
import type { CacheOutcome, Range, Receipt, RouteDecision, Scope } from "./types.ts";

export const AUTO_MODEL = "dropwise/auto";

/** Where a reply goes: an HTTP response, or a collector when a deferred job runs later. */
export interface Out {
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: Uint8Array | string): unknown;
  end(data?: string): unknown;
}

/** Set on a request to have it answered later, at a lower-impact hour: "6h", "90m" or an ISO deadline. */
export const DEFER_HEADER = "x-dropwise-defer";

/** Header names a caller may use for its virtual key, in order of precedence. Bifrost's own header is also forwarded unchanged. */
const KEY_HEADERS = ["x-dropwise-key", "x-bf-vk"];
const FORWARD_HEADERS = ["authorization", "x-bf-vk", "anthropic-version"];

export interface Deps {
  config: GatewayConfig;
  intelligence: IntelligenceClient;
  cache: ResponseCache;
  budgets: Budgets;
  receipts: ReceiptStore;
  jobs: JobStore;
}

export class ProxyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const approxTokens = (text: string) => Math.ceil(text.length / 4);

function lastUserText(body: ChatBody): string {
  const messages = body.messages as { role?: string; content?: unknown }[];
  const last = [...messages].reverse().find((m) => m.role === "user");
  const c = last?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join(" ");
  return "";
}

async function decide(deps: Deps, body: ChatBody): Promise<{ route: RouteDecision | null; note?: string }> {
  try {
    return { route: await deps.intelligence.classify({ messages: body.messages, tools: body.tools }) };
  } catch (err) {
    // Fail safe: without a decision, keep the model the caller asked for and never serve from cache.
    return { route: null, note: `Classifier unavailable (${(err as Error).message}); kept the requested model and skipped the cache.` };
  }
}

function pickModel(config: GatewayConfig, requested: string, route: RouteDecision | null): string {
  const tier = route?.tier ?? "large";
  if (requested === AUTO_MODEL) return tier === "small" ? config.smallModel : config.largeModel;
  if (config.routing && tier === "small" && requested === config.largeModel) return config.smallModel;
  return requested;
}

/** Queue a deferrable request for a lower-impact hour; the caller gets a job to poll, not an answer. */
async function deferRequest(deps: Deps, body: ChatBody, headers: Record<string, string | string[] | undefined>, res: Out, virtualKey: string, defer: string): Promise<void> {
  if (body.stream) throw new ProxyError(400, "A deferred request can't stream: it is answered later, so fetch the result from /jobs/:id");
  let deadline: Date;
  try {
    deadline = parseDeadline(defer);
  } catch (err) {
    throw new ProxyError(400, (err as Error).message);
  }
  // Keep only what the request needs to run later (the key, authorization, the provider header), never the rest.
  const kept: Record<string, string> = {};
  for (const name of [...KEY_HEADERS, ...FORWARD_HEADERS]) {
    const v = headers[name];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) kept[name] = one;
  }
  const preview = deps.config.promptPreviewChars > 0 ? lastUserText(body).replace(/\s+/g, " ").trim().slice(0, deps.config.promptPreviewChars) : undefined;
  const job = await deps.jobs.create({ virtualKey, model: String(body.model), preview, body: body as Record<string, unknown>, headers: kept, deadline });
  res.writeHead(202, { "Content-Type": "application/json", "x-dropwise-job-id": job.id, "x-dropwise-scheduled-for": job.deferred.scheduled_for });
  res.end(
    JSON.stringify({
      object: "dropwise.job",
      job_id: job.id,
      status: job.status,
      deadline: job.deferred.deadline,
      scheduled_for: job.deferred.scheduled_for,
      reason: job.deferred.reason,
      profile: job.deferred.profile,
      poll: `/jobs/${job.id}`,
    }),
  );
}

export async function handleChat(
  deps: Deps,
  body: ChatBody,
  headers: Record<string, string | string[] | undefined>,
  res: Out,
  opts: { deferred?: DeferredInfo } = {},
): Promise<void> {
  const started = performance.now();
  const { config } = deps;
  if (typeof body.model !== "string" || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProxyError(400, 'Body needs "model" and a non-empty "messages" array');
  }
  const requested = body.model;
  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const virtualKey = KEY_HEADERS.map(header).find(Boolean) ?? "default";
  const defer = header(DEFER_HEADER);
  if (defer && !opts.deferred) return deferRequest(deps, body, headers, res, virtualKey, defer);

  const { route, note } = await decide(deps, body);
  const routedTo = pickModel(config, requested, route);

  // Cache
  let cacheOutcome: CacheOutcome;
  let key: string | undefined;
  if (!config.cache) cacheOutcome = "off";
  else if (!cacheable(body)) cacheOutcome = "skipped";
  else if (!route || route.cache === "bypass") cacheOutcome = "bypass";
  else {
    key = cacheKey(body, virtualKey);
    const hit = deps.cache.get(key);
    if (hit) {
      const registry = await deps.intelligence.registry();
      const avoided = registry ? estimate(registry, hit.tokens).water_ml_by_scope : null;
      const receipt = await finish(deps, {
        started, upstreamMs: 0, virtualKey, requested, routedTo: "cache", route, note, body, deferred: opts.deferred,
        tokensIn: 0, tokensOut: 0, tokensEstimated: false, cache: "hit", tokensSaved: hit.tokens, avoided,
        waterByScope: { direct_only: { low: 0, high: 0 }, direct_plus_indirect: { low: 0, high: 0 } }, factorVersions: [],
        method: "Served from cache: no model call, so no inference water.",
      });
      return reply(res, 200, hit.body, receipt);
    }
    cacheOutcome = "miss";
  }

  // Forward to Bifrost
  const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
  for (const name of FORWARD_HEADERS) {
    const v = header(name);
    if (v) forwardHeaders[name] = v;
  }
  const upstreamStart = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${config.bifrostUrl}/v1/chat/completions`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify({ ...body, model: routedTo }),
    });
  } catch (err) {
    throw new ProxyError(502, `Could not reach Bifrost at ${config.bifrostUrl}: ${(err as Error).message}`);
  }

  if (body.stream) return streamThrough(deps, upstream, res, { started, upstreamStart, virtualKey, requested, routedTo, route, note, body });

  const text = await upstream.text();
  const upstreamMs = performance.now() - upstreamStart;
  if (!upstream.ok) {
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(text);
    return;
  }
  const data = JSON.parse(text) as { usage?: Usage; choices?: { message?: { content?: string | null } }[] };
  const usage = data.usage ?? {};
  const tokensEstimated = usage.prompt_tokens === undefined || usage.completion_tokens === undefined;
  const tokensIn = usage.prompt_tokens ?? approxTokens(JSON.stringify(body.messages));
  const tokensOut = usage.completion_tokens ?? approxTokens(data.choices?.[0]?.message?.content ?? "");

  if (key && cacheOutcome === "miss") deps.cache.set(key, data, tokensIn + tokensOut);

  const receipt = await finishWithEstimate(deps, {
    started, upstreamMs, virtualKey, requested, routedTo, route, note, body, tokensIn, tokensOut, tokensEstimated, cache: cacheOutcome, deferred: opts.deferred,
  });
  return reply(res, 200, data, receipt);
}

interface Context {
  /** Set when this request was deferred and is now running at its scheduled hour. */
  deferred?: DeferredInfo;
  started: number;
  upstreamMs: number;
  virtualKey: string;
  requested: string;
  routedTo: string;
  route: RouteDecision | null;
  note?: string;
  body: ChatBody;
  tokensIn: number;
  tokensOut: number;
  tokensEstimated: boolean;
  cache: CacheOutcome;
}

async function finishWithEstimate(deps: Deps, ctx: Context): Promise<Receipt> {
  const registry = await deps.intelligence.registry();
  if (!registry) {
    return finish(deps, { ...ctx, tokensSaved: 0, avoided: null, waterByScope: null, factorVersions: [], method: "No estimate: the Evidence Registry was unreachable." });
  }
  const e = estimate(registry, ctx.tokensIn + ctx.tokensOut);
  return finish(deps, { ...ctx, tokensSaved: 0, avoided: null, waterByScope: e.water_ml_by_scope, factorVersions: e.factor_versions, method: METHOD });
}

async function finish(
  deps: Deps,
  ctx: Context & { tokensSaved: number; avoided: Record<Scope, Range> | null; waterByScope: Record<Scope, Range> | null; factorVersions: string[]; method: string },
): Promise<Receipt> {
  const { config } = deps;
  const { state, alert } = await deps.budgets.record(ctx.virtualKey, ctx.waterByScope);
  const total = performance.now() - ctx.started;
  const preview = config.promptPreviewChars > 0 ? lastUserText(ctx.body).replace(/\s+/g, " ").trim().slice(0, config.promptPreviewChars) : undefined;
  const receipt: Receipt = {
    request_id: `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    created_at: new Date().toISOString(),
    virtual_key: ctx.virtualKey,
    model: ctx.requested,
    routed_to: ctx.routedTo,
    region: "unknown",
    tokens_in: ctx.tokensIn,
    tokens_out: ctx.tokensOut,
    tokens_estimated: ctx.tokensEstimated,
    water_ml: ctx.waterByScope ? ctx.waterByScope[config.scope] : null,
    water_ml_by_scope: ctx.waterByScope,
    scope: config.scope,
    method: ctx.method,
    factor_versions: ctx.factorVersions,
    cache_hit: ctx.cache === "hit",
    cache: ctx.cache,
    route: ctx.route,
    ...(ctx.note ? { route_note: ctx.note } : {}),
    tokens_saved: ctx.tokensSaved,
    avoided_ml_by_scope: ctx.avoided,
    latency_ms: { total: Math.round(total), gateway: Math.round((total - ctx.upstreamMs) * 10) / 10 },
    ...(ctx.deferred ? { deferred: ctx.deferred } : {}),
    budget: state,
    ...(preview ? { prompt_preview: preview } : {}),
  };
  await deps.receipts.add(receipt);
  if (alert) deps.receipts.events.emit("budget_alert", alert);
  return receipt;
}

function receiptHeaders(r: Receipt): Record<string, string> {
  const h: Record<string, string> = {
    "x-dropwise-request-id": r.request_id,
    "x-dropwise-routed-to": r.routed_to,
    "x-dropwise-cache": r.cache,
  };
  if (r.water_ml) h["x-dropwise-water-ml"] = `${r.water_ml.low}-${r.water_ml.high}; scope=${r.scope}; estimated`;
  if (r.budget) h["x-dropwise-budget"] = `${r.budget.status}; ${r.budget.used_pct}%`;
  return h;
}

function reply(res: Out, status: number, data: unknown, receipt: Receipt): void {
  res.writeHead(status, { "Content-Type": "application/json", ...receiptHeaders(receipt) });
  res.end(JSON.stringify(data));
}

// Streaming: pass Bifrost's server-sent events straight through, count what went by, and write the
// receipt once the stream ends. Receipt headers can't be sent first (the stream has started), so the
// request id goes in a trailing SSE comment.
async function streamThrough(
  deps: Deps,
  upstream: Response,
  res: Out,
  ctx: Omit<Context, "upstreamMs" | "tokensIn" | "tokensOut" | "tokensEstimated" | "cache"> & { upstreamStart: number },
): Promise<void> {
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
    "x-dropwise-routed-to": ctx.routedTo,
    "x-dropwise-cache": "skipped",
  });
  if (!upstream.ok || !upstream.body) {
    res.end(await upstream.text());
    return;
  }
  let buffer = "";
  let outText = "";
  let usage: Usage = {};
  const decoder = new TextDecoder();
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    res.write(chunk);
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      try {
        const event = JSON.parse(line.slice(5)) as { usage?: Usage; choices?: { delta?: { content?: string } }[] };
        if (event.usage) usage = event.usage;
        outText += event.choices?.[0]?.delta?.content ?? "";
      } catch {
        // not JSON: ignore
      }
    }
  }
  const upstreamMs = performance.now() - ctx.upstreamStart;
  const tokensEstimated = usage.prompt_tokens === undefined || usage.completion_tokens === undefined;
  const receipt = await finishWithEstimate(deps, {
    ...ctx,
    upstreamMs,
    tokensIn: usage.prompt_tokens ?? approxTokens(JSON.stringify(ctx.body.messages)),
    tokensOut: usage.completion_tokens ?? approxTokens(outText),
    tokensEstimated,
    cache: "skipped",
  });
  res.end(`: dropwise request_id=${receipt.request_id}\n\n`);
}

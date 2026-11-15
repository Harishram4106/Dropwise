// Before/after benchmark (demo step 2): the same workload sent straight to Bifrost, then through Dropwise.
//
//   without_dropwise   app -> Bifrost -> provider, every request asks LARGE_MODEL, no cache
//   with_dropwise      app -> Dropwise -> Bifrost -> provider, same requests, same model asked for
//
// Measured: model calls, cache hits and bypasses, share routed to the small model, tokens, latency, and the
// time each request spent inside Dropwise. Estimated, and labeled so: water (from tokens and registry
// factors, the same estimator the receipts use) and cost (from tokens and list prices).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addRange, estimate, METHOD, ZERO } from "../src/estimator.ts";
import type { Range, Receipt, RegistrySnapshot, RouteDecision, Scope } from "../src/types.ts";
import { CATEGORIES, type Category, type Workload, type WorkloadItem } from "./workload.ts";

export const PRICES_AS_OF = "2026-11";
/** Anthropic list prices, USD per million tokens. Used only for the estimated cost line; edit if they change. */
export const LIST_PRICES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-5-5": { input: 4, output: 20 },
  "anthropic/claude-sonnet-5-5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

const SCOPES: Scope[] = ["direct_only", "direct_plus_indirect"];
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
export const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 15000];
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
/** Stop a run early when its first few requests all fail: the setup is broken, so don't keep paying. */
const FAIL_FAST_AFTER = 3;

export type Side = "without_dropwise" | "with_dropwise";

export interface BenchOptions {
  bifrostUrl: string;
  gatewayUrl: string;
  intelligenceUrl: string;
  workload: Workload;
  /** The model the "app" asks for in both runs: the gateway's LARGE_MODEL, so routing can apply. */
  model: string;
  maxTokens: number;
  concurrency: number;
  bifrostVirtualKey?: string;
  runId?: string;
  retryDelaysMs?: number[];
  /**
   * Stop before the estimated cost of the run (measured tokens at list prices) passes this many US dollars.
   * Ignored when Bifrost is a replay server, which costs nothing.
   */
  maxUsd?: number;
  onProgress?: (side: Side, done: number, total: number) => void;
}

export interface Stats {
  p50: number;
  p95: number;
  mean: number;
}

export interface SideStats {
  requests: number;
  ok: number;
  errors: number;
  retries: number;
  /** Answers that stopped at max_tokens. */
  truncated: number;
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  /** Requests whose provider sent no token usage (approximated as characters / 4). */
  tokens_estimated_requests: number;
  by_model: Record<string, { calls: number; tokens_in: number; tokens_out: number }>;
  latency_ms: Stats;
  wall_ms: number;
  error_samples: string[];
}

export interface WithDropwiseStats extends SideStats {
  cache_hits: number;
  cache_misses: number;
  cache_bypassed: number;
  cache_skipped: number;
  routed_small: number;
  routed_small_share: number;
  /** Time spent inside Dropwise per model call (classifier, cache, receipt and budget), excluding the model. */
  gateway_overhead_ms: Stats;
  cache_hit_latency_ms: Stats;
  receipts_missing: number;
}

export interface CategoryStats {
  requests: number;
  model_calls_without_dropwise: number;
  model_calls_with_dropwise: number;
  routed_small: number;
  cache_hits: number;
  cache_bypassed: number;
}

export interface BenchReport {
  created_at: string;
  run_id: string;
  /** True when no request failed in either run and every Dropwise request has a receipt. */
  clean: boolean;
  workload: Workload["composition"] & { file: string; seed: number; hash: string; system_prompt: string };
  setup: {
    bifrost_url: string;
    gateway_url: string;
    model: string;
    max_tokens: number;
    concurrency: number;
    small_model: string;
    large_model: string;
    routing: boolean;
    cache: boolean;
    registry_version: number | null;
    registry_hash: string;
    classifier_version: string | null;
    /** Set when Bifrost was a replay server: the answers were recorded once, not generated live. */
    replay: { recorded_at: string; model: string; max_tokens: number; answers: number } | null;
  };
  runs: { without_dropwise: SideStats; with_dropwise: WithDropwiseStats };
  measured: {
    calls_avoided: number;
    calls_avoided_share: number;
    tokens_saved: number;
    tokens_saved_share: number;
    tokens_served_from_cache: number;
    cache_hit_share: number;
    cache_bypassed: number;
    routed_small_share: number;
    gateway_overhead_ms: Stats;
  };
  estimated: {
    water_ml: Record<Scope, { without_dropwise: Range; with_dropwise: Range; avoided: Range }>;
    method: string;
    factor_versions: string[];
    cost_usd: { without_dropwise: number | null; with_dropwise: number | null; saved: number | null; prices_per_mtok: typeof LIST_PRICES; prices_as_of: string };
  };
  by_category: Record<Category, CategoryStats>;
  notes: string[];
}

export interface BenchPlan {
  workload: Workload["composition"] & { seed: number; hash: string };
  model: string;
  max_tokens: number;
  routes: boolean;
  cache: boolean;
  predicted: {
    model_calls_without_dropwise: number;
    model_calls_with_dropwise: number;
    cache_hits: number;
    cache_bypassed: number;
    routed_small: number;
    routed_small_share: number;
    by_category: Record<Category, { requests: number; routed_small: number; cache_hits: number; cache_bypassed: number }>;
  };
  decisions: Record<string, RouteDecision>;
  worst_case_cost_usd: number | null;
}

interface Outcome {
  item: WorkloadItem;
  ok: boolean;
  status: number;
  error?: string;
  latencyMs: number;
  retries: number;
  tokensIn: number;
  tokensOut: number;
  tokensEstimated: boolean;
  truncated: boolean;
  /** Model that served the answer ("cache" for a cache hit). */
  model: string;
  requestId?: string;
  receipt?: Receipt;
}

export interface Posted {
  res?: Response;
  text: string;
  status: number;
  latencyMs: number;
  retries: number;
  error?: string;
}

interface GatewayHealth {
  routing: boolean;
  cache: boolean;
  small_model: string;
  large_model: string;
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const share = (part: number, whole: number) => (whole ? round(part / whole, 3) : 0);
const approxTokens = (text: string) => Math.ceil(text.length / 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stats(values: number[]): Stats {
  if (!values.length) return { p50: 0, p95: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: round(at(0.5)), p95: round(at(0.95)), mean: round(values.reduce((a, b) => a + b, 0) / values.length) };
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function messagesFor(workload: Workload, item: WorkloadItem) {
  return [
    { role: "system", content: workload.system_prompt },
    { role: "user", content: item.text },
  ];
}

function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : undefined;
}

/** POST with retries on rate limits, overload and transient server errors. */
export async function post(url: string, headers: Record<string, string>, body: string, delays: number[]): Promise<Posted> {
  let retries = 0;
  for (let attempt = 0; ; attempt++) {
    const start = performance.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const text = await res.text();
      const latencyMs = performance.now() - start;
      if (res.ok || !RETRYABLE.has(res.status) || attempt >= delays.length) return { res, text, status: res.status, latencyMs, retries };
      await sleep(retryAfterMs(res) ?? delays[attempt]);
    } catch (err) {
      if (attempt >= delays.length) return { text: "", status: 0, latencyMs: performance.now() - start, retries, error: (err as Error).message };
      await sleep(delays[attempt]);
    }
    retries++;
  }
}

function toOutcome(item: WorkloadItem, posted: Posted, model: string, messages: unknown): Outcome {
  const base: Outcome = { item, ok: false, status: posted.status, latencyMs: posted.latencyMs, retries: posted.retries, tokensIn: 0, tokensOut: 0, tokensEstimated: false, truncated: false, model };
  if (!posted.res?.ok) return { ...base, error: posted.error ?? `HTTP ${posted.status}: ${posted.text.slice(0, 300)}` };
  let data: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  try {
    data = JSON.parse(posted.text);
  } catch {
    return { ...base, error: `HTTP ${posted.status} but the body was not JSON: ${posted.text.slice(0, 200)}` };
  }
  const usage = data.usage ?? {};
  const choice = data.choices?.[0];
  return {
    ...base,
    ok: true,
    tokensIn: usage.prompt_tokens ?? approxTokens(JSON.stringify(messages)),
    tokensOut: usage.completion_tokens ?? approxTokens(choice?.message?.content ?? ""),
    tokensEstimated: usage.prompt_tokens === undefined || usage.completion_tokens === undefined,
    truncated: choice?.finish_reason === "length",
  };
}

/**
 * Sends the workload with up to `concurrency` requests in flight, in sequence order. A repeat waits for its
 * first sending to finish, as it would in real traffic, so the cache has the answer to give.
 */
async function runSide(
  items: WorkloadItem[],
  send: (item: WorkloadItem) => Promise<Outcome>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
  /** Checked before each request; a reason stops the run. */
  stopReason?: () => string | undefined,
): Promise<{ outcomes: Outcome[]; wallMs: number }> {
  const firstSent = new Map<string, { done: Promise<void>; resolve: () => void }>();
  for (const it of items) {
    if (it.repeat || firstSent.has(it.id)) continue;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    firstSent.set(it.id, { done, resolve });
  }

  const outcomes: Outcome[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  let failed = 0;
  let abort: string | undefined;
  const started = performance.now();

  const worker = async () => {
    while (next < items.length && !abort && !stopReason?.()) {
      const i = next++;
      const item = items[i];
      if (item.repeat) await firstSent.get(item.id)?.done;
      const outcome = await send(item);
      outcomes[i] = outcome;
      if (!item.repeat) firstSent.get(item.id)?.resolve();
      completed++;
      if (!outcome.ok) failed++;
      if (completed === FAIL_FAST_AFTER && failed === completed) abort = outcome.error;
      onProgress?.(completed, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  if (abort) throw new Error(`Stopped: the first ${FAIL_FAST_AFTER} requests all failed. Last error: ${abort}`);
  const reason = stopReason?.();
  if (reason) throw new Error(reason);
  return { outcomes, wallMs: performance.now() - started };
}

function sideStats(outcomes: Outcome[], wallMs: number, isCall: (o: Outcome) => boolean): SideStats {
  const ok = outcomes.filter((o) => o.ok);
  const byModel: SideStats["by_model"] = {};
  for (const o of ok) {
    if (!isCall(o)) continue;
    const m = (byModel[o.model] ??= { calls: 0, tokens_in: 0, tokens_out: 0 });
    m.calls++;
    m.tokens_in += o.tokensIn;
    m.tokens_out += o.tokensOut;
  }
  const tokensIn = ok.reduce((n, o) => n + o.tokensIn, 0);
  const tokensOut = ok.reduce((n, o) => n + o.tokensOut, 0);
  return {
    requests: outcomes.length,
    ok: ok.length,
    errors: outcomes.length - ok.length,
    retries: outcomes.reduce((n, o) => n + o.retries, 0),
    truncated: ok.filter((o) => o.truncated).length,
    model_calls: ok.filter(isCall).length,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tokens_total: tokensIn + tokensOut,
    tokens_estimated_requests: ok.filter((o) => o.tokensEstimated).length,
    by_model: byModel,
    latency_ms: stats(ok.map((o) => o.latencyMs)),
    wall_ms: Math.round(wallMs),
    error_samples: [...new Set(outcomes.filter((o) => !o.ok).map((o) => o.error ?? `HTTP ${o.status}`))].slice(0, 3),
  };
}

export function costUSD(byModel: SideStats["by_model"]): number | null {
  let total = 0;
  for (const [model, use] of Object.entries(byModel)) {
    const price = LIST_PRICES[model];
    if (!price) return null;
    total += (use.tokens_in * price.input + use.tokens_out * price.output) / 1e6;
  }
  return Math.round(total * 10000) / 10000;
}

const minus = (a: Range, b: Range): Range => ({ low: round(a.low - b.low, 4), high: round(a.high - b.high, 4) });

export async function runBenchmark(options: BenchOptions): Promise<BenchReport> {
  const { workload, model, maxTokens } = options;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const registry = await getJSON<RegistrySnapshot>(`${options.intelligenceUrl}/registry`);
  const health = await getJSON<GatewayHealth>(`${options.gatewayUrl}/health`);
  // A replay server answers GET /replay; Bifrost doesn't. Replayed runs cost nothing, so the spend guard is off.
  const replayInfo = await fetch(`${options.bifrostUrl}/replay`, { signal: AbortSignal.timeout(2000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ replay?: boolean; recorded_at: string; model: string; max_tokens: number; answers: number }>) : null))
    .catch(() => null);
  const replay = replayInfo?.replay ? { recorded_at: replayInfo.recorded_at, model: replayInfo.model, max_tokens: replayInfo.max_tokens, answers: replayInfo.answers } : null;
  let spent = 0;
  let stopped: string | undefined;
  const charge = (modelName: string | null | undefined, tokensIn: number, tokensOut: number) => {
    if (replay || options.maxUsd === undefined || stopped) return;
    const price = LIST_PRICES[modelName ?? ""];
    if (price) spent += (tokensIn * price.input + tokensOut * price.output) / 1e6;
    if (spent > options.maxUsd) stopped = `Spend guard: the run's estimated cost passed the $${options.maxUsd.toFixed(2)} limit (about $${spent.toFixed(2)} so far), so it stopped. Nothing was saved.`;
  };
  const stopReason = () => stopped;
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const benchKey = `bench-${runId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.bifrostVirtualKey ? { "x-bf-vk": options.bifrostVirtualKey } : {}) };
  const bodyFor = (item: WorkloadItem) => JSON.stringify({ model, max_tokens: maxTokens, messages: messagesFor(workload, item) });

  // 1. Without Dropwise: straight to Bifrost.
  const without = await runSide(
    workload.items,
    async (item) => {
      const outcome = toOutcome(item, await post(`${options.bifrostUrl}/v1/chat/completions`, headers, bodyFor(item), delays), model, messagesFor(workload, item));
      if (outcome.ok) charge(model, outcome.tokensIn, outcome.tokensOut);
      return outcome;
    },
    options.concurrency,
    (done, total) => options.onProgress?.("without_dropwise", done, total),
    stopReason,
  );

  // 2. With Dropwise: the same requests through the gateway, under a virtual key of their own so the run
  // starts with an empty cache and its receipts can be read back.
  const withDropwise = await runSide(
    workload.items,
    async (item) => {
      const posted = await post(`${options.gatewayUrl}/v1/chat/completions`, { ...headers, "x-dropwise-key": benchKey }, bodyFor(item), delays);
      const outcome = toOutcome(item, posted, model, messagesFor(workload, item));
      outcome.requestId = posted.res?.headers.get("x-dropwise-request-id") ?? undefined;
      // A cache hit made no model call, so it costs nothing; anything else is priced at the model that served it.
      if (outcome.ok && posted.res?.headers.get("x-dropwise-cache") !== "hit") charge(posted.res?.headers.get("x-dropwise-routed-to") ?? model, outcome.tokensIn, outcome.tokensOut);
      return outcome;
    },
    options.concurrency,
    (done, total) => options.onProgress?.("with_dropwise", done, total),
    stopReason,
  );

  // Token counts, model and cache outcome come from the receipts: a cache hit returns the original answer's
  // body, whose usage would otherwise be counted twice.
  const receipts = await getJSON<Receipt[]>(`${options.gatewayUrl}/receipts?virtual_key=${encodeURIComponent(benchKey)}&limit=500`);
  const byId = new Map(receipts.map((r) => [r.request_id, r]));
  let receiptsMissing = 0;
  for (const o of withDropwise.outcomes) {
    if (!o.ok) continue;
    const r = o.requestId ? byId.get(o.requestId) : undefined;
    if (!r) {
      receiptsMissing++;
      continue;
    }
    o.receipt = r;
    o.tokensIn = r.tokens_in;
    o.tokensOut = r.tokens_out;
    o.tokensEstimated = r.tokens_estimated;
    o.model = r.routed_to;
  }

  const withOk = withDropwise.outcomes.filter((o) => o.ok && o.receipt);
  const calls = withOk.filter((o) => o.receipt!.cache !== "hit");
  const hits = withOk.filter((o) => o.receipt!.cache === "hit");
  const routedSmall = calls.filter((o) => o.receipt!.route?.tier === "small" && o.receipt!.routed_to !== o.receipt!.model);

  const withoutStats = sideStats(without.outcomes, without.wallMs, () => true);
  const withStats: WithDropwiseStats = {
    ...sideStats(withDropwise.outcomes, withDropwise.wallMs, (o) => o.receipt?.cache !== "hit"),
    cache_hits: hits.length,
    cache_misses: withOk.filter((o) => o.receipt!.cache === "miss").length,
    cache_bypassed: withOk.filter((o) => o.receipt!.cache === "bypass").length,
    cache_skipped: withOk.filter((o) => o.receipt!.cache === "skipped" || o.receipt!.cache === "off").length,
    routed_small: routedSmall.length,
    routed_small_share: share(routedSmall.length, calls.length),
    gateway_overhead_ms: stats(calls.map((o) => o.receipt!.latency_ms.gateway)),
    cache_hit_latency_ms: stats(hits.map((o) => o.latencyMs)),
    receipts_missing: receiptsMissing,
  };

  // Water: "without" applies the receipts' estimator to the tokens measured in the run without Dropwise;
  // "with" adds up the receipts themselves (a cache hit made no model call, so it adds nothing).
  const water = {} as BenchReport["estimated"]["water_ml"];
  for (const scope of SCOPES) {
    let w = ZERO;
    for (const o of without.outcomes) if (o.ok) w = addRange(w, estimate(registry, o.tokensIn + o.tokensOut).water_ml_by_scope[scope]);
    let d = ZERO;
    for (const o of withOk) if (o.receipt!.water_ml_by_scope) d = addRange(d, o.receipt!.water_ml_by_scope[scope]);
    water[scope] = { without_dropwise: w, with_dropwise: d, avoided: minus(w, d) };
  }

  const costWithout = costUSD(withoutStats.by_model);
  const costWith = costUSD(withStats.by_model);

  const byCategory = {} as Record<Category, CategoryStats>;
  for (const c of CATEGORIES) {
    const inCat = (o: Outcome) => o.item.category === c;
    byCategory[c] = {
      requests: workload.items.filter((i) => i.category === c).length,
      model_calls_without_dropwise: without.outcomes.filter((o) => o.ok && inCat(o)).length,
      model_calls_with_dropwise: calls.filter(inCat).length,
      routed_small: routedSmall.filter(inCat).length,
      cache_hits: hits.filter(inCat).length,
      cache_bypassed: withOk.filter((o) => inCat(o) && o.receipt!.cache === "bypass").length,
    };
  }

  const { composition } = workload;
  const report: BenchReport = {
    created_at: new Date().toISOString(),
    run_id: runId,
    clean: withoutStats.errors === 0 && withStats.errors === 0 && receiptsMissing === 0,
    workload: { file: "gateway/bench/prompts.json", seed: workload.seed, hash: workload.hash, system_prompt: workload.system_prompt, ...composition },
    setup: {
      bifrost_url: options.bifrostUrl,
      gateway_url: options.gatewayUrl,
      model,
      max_tokens: maxTokens,
      concurrency: options.concurrency,
      small_model: health.small_model,
      large_model: health.large_model,
      routing: health.routing,
      cache: health.cache,
      registry_version: registry.version,
      registry_hash: registry.registry_hash,
      classifier_version: withOk.find((o) => o.receipt!.route)?.receipt!.route!.classifier_version ?? null,
      replay,
    },
    runs: { without_dropwise: withoutStats, with_dropwise: withStats },
    measured: {
      calls_avoided: withoutStats.model_calls - withStats.model_calls,
      calls_avoided_share: share(withoutStats.model_calls - withStats.model_calls, withoutStats.model_calls),
      tokens_saved: withoutStats.tokens_total - withStats.tokens_total,
      tokens_saved_share: share(withoutStats.tokens_total - withStats.tokens_total, withoutStats.tokens_total),
      tokens_served_from_cache: hits.reduce((n, o) => n + o.receipt!.tokens_saved, 0),
      cache_hit_share: share(hits.length, withOk.length),
      cache_bypassed: withStats.cache_bypassed,
      routed_small_share: withStats.routed_small_share,
      gateway_overhead_ms: withStats.gateway_overhead_ms,
    },
    estimated: {
      water_ml: water,
      method: METHOD,
      factor_versions: estimate(registry, 1).factor_versions,
      cost_usd: {
        without_dropwise: costWithout,
        with_dropwise: costWith,
        saved: costWithout !== null && costWith !== null ? Math.round((costWithout - costWith) * 10000) / 10000 : null,
        prices_per_mtok: LIST_PRICES,
        prices_as_of: PRICES_AS_OF,
      },
    },
    by_category: byCategory,
    notes: [
      `Workload: ${composition.requests} requests, ${composition.unique_prompts} unique prompts, ${composition.repeats} sent twice word for word (${Math.round(composition.repeat_share * 100)}%), seed ${workload.seed}. The repeat share is an assumption about traffic, not a measurement; cache savings scale with it.`,
      `Both runs ask for ${model} with max_tokens ${maxTokens}, the same system prompt and ${options.concurrency} requests in flight. Without Dropwise every request goes straight to Bifrost; with Dropwise the same requests go through the gateway.`,
      replay
        ? `Answers were replayed, not generated live: each prompt was sent once to ${replay.model} on ${replay.recorded_at.slice(0, 10)} (max_tokens ${replay.max_tokens}) and both runs get that same recorded answer, whichever model the request names. Token totals therefore differ between the runs only by what Dropwise avoided; request latency includes the recorded model time.`
        : "Model answers differ from run to run, so token totals include that variation as well as Dropwise's effect.",
      "Water is estimated from measured tokens with signed registry factors, as on the receipts. Routing to a smaller model doesn't change it, because the registry has no per-model energy figure; only calls avoided and shorter answers do.",
      replay
        ? `Cost is a what-if: the recorded answers' measured tokens priced at list rates (USD per million tokens, ${PRICES_AS_OF}) for the model that served each call. A call kept on the large model is priced as if it had produced an answer of the same length, which is an assumption.`
        : `Cost is estimated from measured tokens at list prices (USD per million tokens, ${PRICES_AS_OF}).`,
      "Gateway overhead is the time a request spent inside Dropwise (classifier call, cache lookup, receipt and budget writes), excluding the model call.",
      "Prompt categories are the team's own labels, used only for the breakdown; the gateway never sees them.",
    ],
  };
  return report;
}

/** What the classifier would do with this workload, without calling any model. */
export async function planBenchmark(options: {
  intelligenceUrl: string;
  workload: Workload;
  model: string;
  maxTokens: number;
  routes: boolean;
  cache: boolean;
}): Promise<BenchPlan> {
  const { workload } = options;
  const decisions: Record<string, RouteDecision> = {};
  const unique = [...new Map(workload.items.map((i) => [i.id, i])).values()];
  for (let i = 0; i < unique.length; i += 10) {
    await Promise.all(
      unique.slice(i, i + 10).map(async (item) => {
        const res = await fetch(`${options.intelligenceUrl}/route/classify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messagesFor(workload, item) }),
        });
        if (!res.ok) throw new Error(`classify ${item.id} returned ${res.status}: ${await res.text()}`);
        decisions[item.id] = (await res.json()) as RouteDecision;
      }),
    );
  }

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, { requests: 0, routed_small: 0, cache_hits: 0, cache_bypassed: 0 }])) as BenchPlan["predicted"]["by_category"];
  let hits = 0;
  let bypassed = 0;
  let small = 0;
  for (const item of workload.items) {
    const d = decisions[item.id];
    const cat = byCategory[item.category];
    cat.requests++;
    const hit = options.cache && item.repeat && d.cache === "use";
    if (options.cache && d.cache === "bypass") {
      bypassed++;
      cat.cache_bypassed++;
    }
    if (hit) {
      hits++;
      cat.cache_hits++;
    } else if (options.routes && d.tier === "small") {
      small++;
      cat.routed_small++;
    }
  }

  const price = LIST_PRICES[options.model];
  const worstOneRun = price
    ? workload.items.reduce((usd, item) => usd + (approxTokens(JSON.stringify(messagesFor(workload, item))) * price.input + options.maxTokens * price.output) / 1e6, 0)
    : null;
  const calls = workload.items.length - hits;
  return {
    workload: { seed: workload.seed, hash: workload.hash, ...workload.composition },
    model: options.model,
    max_tokens: options.maxTokens,
    routes: options.routes,
    cache: options.cache,
    predicted: {
      model_calls_without_dropwise: workload.items.length,
      model_calls_with_dropwise: calls,
      cache_hits: hits,
      cache_bypassed: bypassed,
      routed_small: small,
      routed_small_share: share(small, calls),
      by_category: byCategory,
    },
    decisions,
    // Upper bound: every answer uses all of max_tokens, and nothing is routed or cached in either run.
    worst_case_cost_usd: worstOneRun === null ? null : Math.round(worstOneRun * 2 * 100) / 100,
  };
}

export async function saveReport(report: BenchReport, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `bench-${report.run_id}.json`);
  const text = JSON.stringify(report, null, 2) + "\n";
  await writeFile(file, text);
  await writeFile(join(dir, "latest.json"), text);
  return file;
}

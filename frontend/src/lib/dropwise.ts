// Shapes and helpers shared by the dashboard pages. Types follow dropwise/contracts/water-receipt.schema.json
// and the gateway's GET /summary and GET /health responses.

export type Scope = "direct_only" | "direct_plus_indirect";
export type CacheOutcome = "hit" | "miss" | "bypass" | "skipped" | "off";

export interface Range {
  low: number;
  high: number;
}

export interface RouteDecision {
  tier: "small" | "large";
  confidence: number;
  time_sensitive: boolean;
  cache: "use" | "bypass";
  signals: string[];
  reasons: string[];
  classifier_version: string;
}

export type BudgetStatus = "ok" | "alert" | "soft_limit";

export interface BudgetState {
  virtual_key: string;
  period: string;
  scope: Scope;
  limit_ml: number;
  used_ml: Range;
  used_pct: number;
  status: BudgetStatus;
}

/** An alert the gateway raised when a key crossed 80% or 100% of its budget (GET /budgets). */
export interface BudgetAlert {
  at: string;
  virtual_key: string;
  period: string;
  status: BudgetStatus;
  used_pct: number;
}

export interface BudgetsResponse {
  period: "day" | "month";
  budgets: BudgetState[];
  alerts: BudgetAlert[];
}

export const ALERT_PCT = 80;
/** The gateway's thresholds: alert from 80%, soft limit from 100% (requests are still served). */
export const budgetStatus = (pct: number): BudgetStatus => (pct >= 100 ? "soft_limit" : pct >= ALERT_PCT ? "alert" : "ok");

/** One factor in the Evidence Registry (contracts/registry-entry.schema.json). */
export interface RegistryEntry {
  factor_id: string;
  label: string;
  value: number | null;
  range: Range;
  unit: string;
  counts: "direct_only" | "indirect_only" | "direct_plus_indirect" | "unclear" | "not_applicable";
  source_url: string;
  source_title: string;
  source_date: string;
  evidence: string;
  freshness_score: number;
  last_verified: string;
  verified_by: "manual" | "tavily";
  status: "verified" | "draft" | "stale";
  superseded_by?: string;
  version_hash: string;
}

export interface Registry {
  version: number | null;
  published_at: string | null;
  registry_hash: string;
  entries: RegistryEntry[];
}

export interface Receipt {
  request_id: string;
  created_at: string;
  virtual_key: string;
  model: string;
  routed_to: string;
  region: string;
  tokens_in: number;
  tokens_out: number;
  tokens_estimated: boolean;
  water_ml: Range | null;
  water_ml_by_scope: Record<Scope, Range> | null;
  scope: Scope;
  method: string;
  factor_versions: string[];
  cache_hit: boolean;
  cache: CacheOutcome;
  route: RouteDecision | null;
  route_note?: string;
  tokens_saved: number;
  avoided_ml_by_scope: Record<Scope, Range> | null;
  latency_ms: { total: number; gateway: number };
  deferred?: DeferredInfo;
  budget?: BudgetState | null;
  prompt_preview?: string;
}

export interface Summary {
  scope: Scope;
  measured: {
    requests: number;
    model_calls: number;
    cache_hits: number;
    calls_avoided: number;
    cache_bypassed: number;
    routed_small: number;
    routed_small_share: number;
    tokens_in: number;
    tokens_out: number;
    tokens_saved: number;
    gateway_latency_ms: { p50: number; p95: number };
  };
  estimated: {
    water_ml_without_dropwise: Range;
    water_ml_with_dropwise: Range;
    water_ml_avoided: Range;
  };
}

export interface Health {
  ok: boolean;
  intelligence: boolean;
  routing: boolean;
  cache: boolean;
  small_model: string;
  large_model: string;
}

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8088").replace(/\/+$/, "");
export const INTELLIGENCE_URL = (process.env.NEXT_PUBLIC_INTELLIGENCE_URL || "http://localhost:8787").replace(/\/+$/, "");
export const DEMO_FORCED = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/** `?scope=direct` counts on-site water only; anything else counts direct + indirect. */
export const scopeFromParam = (v: string | null): Scope => (v === "direct" ? "direct_only" : "direct_plus_indirect");
export const SCOPE_LABEL: Record<Scope, string> = { direct_only: "Direct only", direct_plus_indirect: "Direct + indirect" };

const ZERO: Range = { low: 0, high: 0 };
const add = (a: Range, b: Range): Range => ({ low: a.low + b.low, high: a.high + b.high });

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/** The gateway's GET /summary, computed from receipts in the browser (used in demo mode). */
export function summarize(receipts: Receipt[], scope: Scope): Summary {
  const hits = receipts.filter((r) => r.cache_hit);
  const calls = receipts.filter((r) => !r.cache_hit);
  const routedSmall = calls.filter((r) => r.route?.tier === "small" && r.routed_to !== r.model);
  let withDropwise = ZERO;
  let avoided = ZERO;
  for (const r of receipts) {
    if (r.water_ml_by_scope) withDropwise = add(withDropwise, r.water_ml_by_scope[scope]);
    if (r.avoided_ml_by_scope) avoided = add(avoided, r.avoided_ml_by_scope[scope]);
  }
  const gateway = receipts.map((r) => r.latency_ms.gateway);
  return {
    scope,
    measured: {
      requests: receipts.length,
      model_calls: calls.length,
      cache_hits: hits.length,
      calls_avoided: hits.length,
      cache_bypassed: receipts.filter((r) => r.cache === "bypass").length,
      routed_small: routedSmall.length,
      routed_small_share: calls.length ? Math.round((routedSmall.length / calls.length) * 1000) / 1000 : 0,
      tokens_in: receipts.reduce((n, r) => n + r.tokens_in, 0),
      tokens_out: receipts.reduce((n, r) => n + r.tokens_out, 0),
      tokens_saved: receipts.reduce((n, r) => n + r.tokens_saved, 0),
      gateway_latency_ms: { p50: percentile(gateway, 50), p95: percentile(gateway, 95) },
    },
    estimated: {
      water_ml_without_dropwise: add(withDropwise, avoided),
      water_ml_with_dropwise: withDropwise,
      water_ml_avoided: avoided,
    },
  };
}

/** "anthropic/claude-opus-5-5" -> "Opus 5.5"; anything unfamiliar is shown as sent. */
export function modelName(id: string): string {
  if (id === "cache") return "Cache";
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id.split("/").pop() ?? id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** Water values span 0.01 to thousands of mL; keep two significant figures for small ones. */
export function fmtMl(v: number): string {
  // Animated counters can land a hair below zero from floating-point error; water is never negative.
  if (v < 1e-6) return "0";
  if (v < 1) return v.toPrecision(2);
  if (v < 100) return v.toFixed(1);
  return Math.round(v).toLocaleString("en-US");
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Freshness thresholds from the landing registry table: 0.75 and up green, 0.5 and up amber, below that orange. */
export const freshnessTone = (v: number) => (v >= 0.75 ? "fresh" : v >= 0.5 ? "amber" : "old");

/** "datacenter-wue-onsite@sha256:14ad…" -> { id, hash } */
export function splitFactor(fv: string): { id: string; hash: string } {
  const at = fv.indexOf("@");
  return at < 0 ? { id: fv, hash: "" } : { id: fv.slice(0, at), hash: fv.slice(at + 1) };
}

export const shortHash = (h: string) => {
  const hex = h.replace(/^sha256:/, "");
  return hex.length > 8 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex;
};

/* ---- before / after benchmark (contracts/benchmark-report.schema.json) ---- */

export interface Stats {
  p50: number;
  p95: number;
  mean: number;
}

export interface BenchSide {
  requests: number;
  ok: number;
  errors: number;
  retries: number;
  truncated: number;
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  tokens_estimated_requests: number;
  by_model: Record<string, { calls: number; tokens_in: number; tokens_out: number }>;
  latency_ms: Stats;
  wall_ms: number;
  error_samples: string[];
  cache_hits?: number;
  cache_misses?: number;
  cache_bypassed?: number;
  cache_skipped?: number;
  routed_small?: number;
  routed_small_share?: number;
  gateway_overhead_ms?: Stats;
  cache_hit_latency_ms?: Stats;
  receipts_missing?: number;
}

export type PromptCategory = "easy" | "hard" | "time_sensitive";

export interface BenchCategory {
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
  clean: boolean;
  workload: { file: string; seed: number; hash: string; system_prompt: string; requests: number; unique_prompts: number; repeats: number; repeat_share: number; by_category: Record<string, unknown> };
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
    /** Set when the answers were replayed from a recording instead of generated live. */
    replay?: { recorded_at: string; model: string; max_tokens: number; answers: number } | null;
  };
  runs: { without_dropwise: BenchSide; with_dropwise: BenchSide };
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
    cost_usd: { without_dropwise: number | null; with_dropwise: number | null; saved: number | null; prices_as_of: string };
  };
  by_category: Record<PromptCategory, BenchCategory>;
  notes: string[];
}

/** Answer quality after right-sizing (contracts/quality-report.schema.json, GET /eval/quality). */
export interface QualityReport {
  created_at: string;
  eval_set_hash: string;
  classifier_version: string;
  small_model: string;
  large_model: string;
  method: string;
  items_scored: number;
  routed_small_share: number;
  pass_rate: { all_large: number; routed: number; all_small: number };
  quality_drop_pts: number;
  max_drop_pts: number;
  guard: "pass" | "fail";
  recommendation: string;
  lost: string[];
}

/** Classifier signals that mean the answer can go out of date, so the cache is skipped. */
export const TIME_SIGNALS = new Set(["relative_time", "recency", "outage", "volatile_topic", "live_data", "date"]);

/** One wrong call the routing eval found (GET /eval/routing). */
export interface RoutingMistake {
  id: string;
  prompt: string;
  expected: string;
  got: string;
  signals: string[];
}

/** The classifier's score on its eval set (GET /eval/routing); offline, no model involved. */
export interface RoutingEval {
  items: number;
  tier_accuracy: number;
  routed_small_share: number;
  hard_routed_small: RoutingMistake[];
  easy_kept_large: RoutingMistake[];
  time_sensitivity: { precision: number; recall: number; false_positives: RoutingMistake[]; missed: RoutingMistake[] };
  avg_classify_us: number;
}

/* ---- claim checker (contracts/claim-result.schema.json) ---- */

export type Verdict = "supported" | "overstated" | "understated" | "unsupported" | "outdated";

export interface AtomicClaim {
  text: string;
  counts: RegistryEntry["counts"];
  verdict: Verdict;
  explanation: string;
  claimed: { low: number; high: number; unit: string } | null;
  freshness_score: number;
  sources: string[];
  registry_factors: string[];
}

export interface ClaimResult {
  claim: string;
  checked_at: string;
  decomposition: "model" | "rules";
  evidence: "registry" | "registry_and_live";
  registry_hash: string | null;
  atomic_claims: AtomicClaim[];
}

/** GET /demo/stale-factor: a 2016 figure flagged stale by a newer source. `warning` is set when live search wasn't possible. */
export interface StaleDemo {
  mode: string;
  warning?: string;
  before: RegistryEntry;
  after: RegistryEntry;
  outcome: { factor_id: string; action: string; detail: string };
  newer_source: Candidate;
  explanation: string;
}

/** A figure a refresh found that no one has accepted yet (intelligence API GET /registry/candidates). */
export interface Candidate {
  factor_id: string;
  value: number | null;
  range: Range;
  unit: string;
  counts: string;
  source_url: string;
  source_title: string;
  source_date: string;
  /** "url" when neither the source nor the model gave a date and it was read from the URL path. */
  source_date_inferred?: "url";
  evidence: string;
  found_at: string;
}

export interface ReviewGroup {
  factor_id: string;
  label: string;
  /** What the signed registry holds now, or null for a factor with no entry yet. */
  current: RegistryEntry | null;
  items: { candidate: Candidate; accept_command: string }[];
}

/* ---- time shifting (gateway GET /jobs; contracts/water-receipt.schema.json `deferred`) ---- */

export interface DeferredInfo {
  job_id: string;
  requested_at: string;
  deadline: string;
  scheduled_for: string;
  ran_at: string | null;
  run_early: boolean;
  profile: { name: string; source: string; illustrative: boolean; timezone: string } | null;
  relative_index: { at_request: number; at_run: number } | null;
  reason: string;
}

export type JobStatus = "scheduled" | "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  virtual_key: string;
  model: string;
  prompt_preview?: string;
  deferred: DeferredInfo;
  receipt_id?: string;
  error?: string;
  result?: unknown;
  updated_at: string;
}

/** The hourly profile deferred jobs are scheduled against: a relative index per local hour, not a water figure. */
export interface HourlyProfile {
  name: string;
  source: string;
  source_url?: string;
  illustrative: boolean;
  timezone: string;
  relative_index: number[];
}

/** The local hour (0..23) and minute of a moment in a time zone. */
export function zonedClock(ms: number, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute") };
}

/** "Fri 02:00" in a time zone. */
export const zonedLabel = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(iso)).replace(",", "");

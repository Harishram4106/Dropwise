// Shapes the gateway produces. The receipt follows contracts/water-receipt.schema.json.

import type { DeferredInfo } from "./jobs.ts";

export type Scope = "direct_only" | "direct_plus_indirect";
export type Tier = "small" | "large";

export interface Range {
  low: number;
  high: number;
}

/** Route decision from the intelligence API (contracts/route-decision.schema.json). */
export interface RouteDecision {
  tier: Tier;
  confidence: number;
  time_sensitive: boolean;
  cache: "use" | "bypass";
  signals: string[];
  reasons: string[];
  classifier_version: string;
}

/** The registry fields the estimator reads (contracts/registry-entry.schema.json). */
export interface RegistryEntry {
  factor_id: string;
  range: Range;
  unit: string;
  status: "verified" | "draft" | "stale";
  version_hash: string;
}

export interface RegistrySnapshot {
  version: number | null;
  registry_hash: string;
  entries: RegistryEntry[];
}

/**
 * hit: served from cache, no model call. miss: called the model and stored the answer.
 * bypass: time-sensitive, so the cache was skipped. skipped: not cacheable (streaming, tools).
 * off: caching is turned off.
 */
export type CacheOutcome = "hit" | "miss" | "bypass" | "skipped" | "off";

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
  /** Present when the request was deferred to a lower-impact hour. */
  deferred?: DeferredInfo;
  budget: BudgetState | null;
  prompt_preview?: string;
}

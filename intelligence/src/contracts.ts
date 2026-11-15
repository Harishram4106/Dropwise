// Mirrors contracts/*.schema.json at the repo root; keep both in sync.

export type Counts = "direct_only" | "indirect_only" | "direct_plus_indirect" | "unclear" | "not_applicable";

export interface Range {
  low: number;
  high: number;
}

export interface RegistryEntry {
  factor_id: string;
  label: string;
  value: number | null;
  range: Range;
  unit: string;
  counts: Counts;
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

export interface FactorSpec {
  factor_id: string;
  label: string;
  unit: string;
  counts: Counts;
  role: "estimator" | "reference";
  // Lower-case names a claim may use for this factor's subject, e.g. "chatgpt".
  subjects?: string[];
  query: string;
  include_domains?: string[];
  time_range?: "day" | "week" | "month" | "year";
}

export interface Candidate {
  factor_id: string;
  value: number | null;
  range: Range;
  unit: string;
  counts: Counts;
  source_url: string;
  source_title: string;
  source_date: string;
  /** Set to "url" when neither the source's metadata nor the model gave a date and it was read from the URL path. Review before accepting. */
  source_date_inferred?: "url";
  evidence: string;
  found_at: string;
}

export type Verdict = "supported" | "overstated" | "understated" | "unsupported" | "outdated";

export interface AtomicClaim {
  text: string;
  counts: Counts;
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

export interface RegistryVersion {
  version: number;
  created_at: string;
  previous_hash: string | null;
  entries: RegistryEntry[];
  registry_hash: string;
  signature: string;
  public_key_fingerprint: string;
}

export type Tier = "small" | "large";

export interface RouteDecision {
  tier: Tier;
  confidence: number;
  time_sensitive: boolean;
  cache: "use" | "bypass";
  signals: string[];
  reasons: string[];
  classifier_version: string;
}

export interface QualityItemResult {
  id: string;
  tier: Tier;
  large_pass: boolean;
  routed_pass: boolean;
  small_pass: boolean;
  answers: { large: string; small: string };
}

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
  results: QualityItemResult[];
}

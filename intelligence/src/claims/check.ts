import type { Candidate, ClaimResult, FactorSpec, RegistryEntry } from "../contracts.ts";
import { extractFigure } from "../extract.ts";
import { freshnessScore } from "../freshness.ts";
import { loadEntries, loadFactors, loadVersions } from "../store.ts";
import { tavilySearch } from "../tavily.ts";
import { decompose, type Atomic } from "./decompose.ts";
import { parseQuantity } from "./quantity.ts";
import { judge, type Evidence } from "./verdict.ts";

export const MAX_CLAIM_LENGTH = 1000;

const LIVE_DOMAINS = [
  "arxiv.org", "nature.com", "acm.org", "ieee.org", "iea.org", "oecd.org",
  "mistral.ai", "blog.google", "cloud.google.com", "openai.com", "ucr.edu", "epoch.ai",
];

export interface CheckOptions {
  useModel?: boolean;
  useLive?: boolean;
  now?: Date;
}

// Checks run against the latest signed registry version when one exists, so every verdict is traceable to a hash.
export async function loadRegistry(): Promise<{ entries: RegistryEntry[]; specs: FactorSpec[]; registry_hash: string | null }> {
  const [versions, specs] = await Promise.all([loadVersions(), loadFactors()]);
  const latest = versions.at(-1);
  if (latest) return { entries: latest.entries, specs, registry_hash: latest.registry_hash };
  return { entries: await loadEntries(), specs, registry_hash: null };
}

export function entryToEvidence(entry: RegistryEntry, spec: FactorSpec | undefined, now = new Date()): Evidence {
  return {
    label: entry.label,
    short: /\(([^)]+)\)\s*$/.exec(entry.label)?.[1] ?? new URL(entry.source_url).hostname,
    range: entry.range,
    unit: entry.unit,
    counts: entry.counts,
    source_url: entry.source_url,
    source_date: entry.source_date,
    freshness_score: freshnessScore(entry.source_date, now),
    stale: entry.status === "stale",
    subjects: spec?.subjects ?? [],
    factor_id: entry.factor_id,
  };
}

function candidateToEvidence(c: Candidate, now: Date): Evidence {
  return {
    label: c.source_title,
    short: `live: ${new URL(c.source_url).hostname}`,
    range: c.range,
    unit: c.unit,
    counts: c.counts,
    source_url: c.source_url,
    source_date: c.source_date,
    freshness_score: freshnessScore(c.source_date, now),
    stale: false,
    subjects: [],
  };
}

async function liveEvidence(atomic: Atomic, now: Date): Promise<Evidence[]> {
  const quantity = parseQuantity(atomic.text) ?? parseQuantity(atomic.context);
  if (!quantity) return [];
  const unit = `${quantity.unit} per response`;
  const spec: FactorSpec = {
    factor_id: "live",
    label: `${quantity.kind} per AI prompt or response, relevant to: ${atomic.text}`,
    unit,
    counts: "unclear",
    role: "reference",
    query: atomic.text,
  };
  const results = await tavilySearch({ query: `${atomic.text} per prompt study`, include_domains: LIVE_DOMAINS, time_range: "year" });
  const evidence: Evidence[] = [];
  for (const result of results.slice(0, 3)) {
    const candidate = await extractFigure(spec, result, now);
    if (candidate) evidence.push(candidateToEvidence({ ...candidate, unit }, now));
  }
  return evidence;
}

export function liveAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY && process.env.EXTRACTION_MODEL);
}

export async function checkClaim(claim: string, options: CheckOptions = {}): Promise<{ result: ClaimResult; warnings: string[] }> {
  const text = claim.trim();
  if (!text) throw new Error("Claim is empty");
  if (text.length > MAX_CLAIM_LENGTH) throw new Error(`Claim is longer than ${MAX_CLAIM_LENGTH} characters`);

  const now = options.now ?? new Date();
  const useModel = options.useModel ?? Boolean(process.env.EXTRACTION_MODEL);
  const useLive = options.useLive ?? liveAvailable();
  const warnings: string[] = [];

  const { entries, specs, registry_hash } = await loadRegistry();
  const specById = new Map(specs.map((s) => [s.factor_id, s]));
  const registryEvidence = entries.map((e) => entryToEvidence(e, specById.get(e.factor_id), now));

  const { atomics, method, warning } = await decompose(text, { useModel });
  if (warning) warnings.push(warning);

  let usedLive = false;
  const atomic_claims = [];
  for (const atomic of atomics) {
    let evidence = registryEvidence;
    if (useLive) {
      try {
        evidence = [...registryEvidence, ...(await liveEvidence(atomic, now))];
        usedLive = true;
      } catch (err) {
        warnings.push(`Live sources unavailable, used registry only: ${(err as Error).message}`);
      }
    }
    atomic_claims.push(judge(atomic, evidence));
  }

  return {
    result: {
      claim: text,
      checked_at: now.toISOString(),
      decomposition: method,
      evidence: usedLive ? "registry_and_live" : "registry",
      registry_hash,
      atomic_claims,
    },
    warnings,
  };
}

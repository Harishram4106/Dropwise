import type { Candidate, FactorSpec, Range, RegistryEntry } from "./contracts.ts";
import { extractFigure } from "./extract.ts";
import { isNewer, today } from "./freshness.ts";
import { tavilySearch } from "./tavily.ts";

const MAX_EXTRACTIONS_PER_FACTOR = 3;

export interface RefreshOutcome {
  factor_id: string;
  action: "reconfirmed" | "flagged_stale" | "not_found_again" | "new_candidates" | "no_candidates";
  detail?: string;
}

export async function findCandidates(spec: FactorSpec, now = new Date()): Promise<Candidate[]> {
  const results = await tavilySearch({
    query: spec.query,
    include_domains: spec.include_domains,
    time_range: spec.time_range,
  });
  const candidates: Candidate[] = [];
  for (const result of results.slice(0, MAX_EXTRACTIONS_PER_FACTOR)) {
    const candidate = await extractFigure(spec, result, now);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// A newer source that agrees with the entry is fine; only a newer source whose range does not
// overlap the entry's range marks it stale, so a factor is never flagged just for being old.
export function reconcile(
  entry: RegistryEntry,
  candidates: Candidate[],
  now = new Date(),
): { entry: RegistryEntry; outcome: RefreshOutcome } {
  const contradicting = candidates
    .filter(
      (c) =>
        baseUnit(c.unit) === baseUnit(entry.unit) &&
        isNewer(c.source_date, entry.source_date) &&
        !overlaps(c.range, entry.range),
    )
    .sort((a, b) => (isNewer(a.source_date, b.source_date) ? -1 : 1));

  if (contradicting.length > 0) {
    const newest = contradicting[0];
    return {
      entry: { ...entry, status: "stale", superseded_by: newest.source_url },
      outcome: {
        factor_id: entry.factor_id,
        action: "flagged_stale",
        detail: `${newest.source_title} (${newest.source_date}) reports ${formatRange(newest.range)} ${newest.unit}`,
      },
    };
  }

  if (candidates.some((c) => c.source_url === entry.source_url)) {
    return {
      entry: { ...entry, last_verified: today(now), verified_by: "tavily" },
      outcome: { factor_id: entry.factor_id, action: "reconfirmed" },
    };
  }

  return { entry, outcome: { factor_id: entry.factor_id, action: "not_found_again" } };
}

export async function refresh(
  specs: FactorSpec[],
  entries: RegistryEntry[],
  now = new Date(),
): Promise<{ entries: RegistryEntry[]; candidates: Record<string, Candidate[]>; outcomes: RefreshOutcome[] }> {
  const byId = new Map(entries.map((e) => [e.factor_id, e]));
  const candidates: Record<string, Candidate[]> = {};
  const outcomes: RefreshOutcome[] = [];

  for (const spec of specs) {
    const found = await findCandidates(spec, now);
    const current = byId.get(spec.factor_id);

    if (current) {
      const { entry, outcome } = reconcile(current, found, now);
      byId.set(spec.factor_id, entry);
      outcomes.push(outcome);
      if (outcome.action === "flagged_stale") candidates[spec.factor_id] = found;
    } else {
      candidates[spec.factor_id] = found;
      outcomes.push({ factor_id: spec.factor_id, action: found.length > 0 ? "new_candidates" : "no_candidates" });
    }
  }

  return { entries: [...byId.values()], candidates, outcomes };
}

export function candidateToEntry(candidate: Candidate, spec: FactorSpec, now = new Date()): RegistryEntry {
  return {
    factor_id: spec.factor_id,
    label: spec.label,
    value: candidate.value,
    range: candidate.range,
    unit: candidate.unit,
    counts: candidate.counts,
    source_url: candidate.source_url,
    source_title: candidate.source_title,
    source_date: candidate.source_date,
    evidence: candidate.evidence,
    freshness_score: 0,
    last_verified: today(now),
    verified_by: "tavily",
    status: "verified",
    version_hash: "",
  };
}

// The quantity before the "per": "L per kWh", "L/kWh" and "l / kWh" are all "l". Models and sources spell it either way.
export function baseUnit(unit: string): string {
  return unit.trim().split(/\s*\/\s*|\s+per\s+/i)[0]?.trim().toLowerCase() ?? "";
}

function overlaps(a: Range, b: Range): boolean {
  return a.low <= b.high && b.low <= a.high;
}

export function formatRange({ low, high }: Range): string {
  return low === high ? `${low}` : `${low}–${high}`;
}

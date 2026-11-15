// Candidates found by a refresh and waiting for a person to accept them. Read-only: accepting stays a CLI step
// (`npm run registry -- accept`), because publishing a registry version needs the private signing key,
// which must never be inside a running service.

import type { Candidate, FactorSpec, RegistryEntry } from "./contracts.ts";
import { freshnessScore } from "./freshness.ts";
import { loadCandidates } from "./store.ts";
import { loadRegistry } from "./claims/check.ts";

export interface ReviewItem {
  candidate: Candidate;
  /** The command that accepts this candidate into the working entries (it then needs `publish` to be signed). */
  accept_command: string;
}

export interface ReviewGroup {
  factor_id: string;
  label: string;
  /** What the signed registry holds for this factor now, or null for a factor with no entry yet. */
  current: RegistryEntry | null;
  items: ReviewItem[];
}

export function buildReview(
  candidates: Record<string, Candidate[]>,
  specs: FactorSpec[],
  entries: RegistryEntry[],
  now = new Date(),
): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  for (const [factorId, found] of Object.entries(candidates)) {
    if (found.length === 0) continue;
    const spec = specs.find((s) => s.factor_id === factorId);
    const entry = entries.find((e) => e.factor_id === factorId) ?? null;
    groups.push({
      factor_id: factorId,
      label: spec?.label ?? entry?.label ?? factorId,
      current: entry ? { ...entry, freshness_score: freshnessScore(entry.source_date, now) } : null,
      items: found.map((candidate, i) => ({ candidate, accept_command: `npm run registry -- accept ${factorId} ${i}` })),
    });
  }
  return groups.sort((a, b) => a.factor_id.localeCompare(b.factor_id));
}

export async function pendingReview(now = new Date()): Promise<ReviewGroup[]> {
  const [{ entries, specs }, candidates] = await Promise.all([loadRegistry(), loadCandidates()]);
  return buildReview(candidates, specs, entries, now);
}

"use client";

// Candidates waiting for review: GET /registry/candidates. Demo mode, or an unreachable API, shows one saved sample
// (the 2024 report from the stale-factor demo), and says so.

import saved from "@/fixtures/candidates.json";
import { INTELLIGENCE_URL, type ReviewGroup } from "@/lib/dropwise";

const SAVED = (saved as unknown as { groups: ReviewGroup[] }).groups;

export async function fetchCandidates(live: boolean): Promise<{ groups: ReviewGroup[]; source: "live" | "saved" }> {
  if (live) {
    try {
      const res = await fetch(`${INTELLIGENCE_URL}/registry/candidates`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (res.ok) return { groups: ((await res.json()) as { groups: ReviewGroup[] }).groups, source: "live" };
    } catch {
      // fall back to the saved sample
    }
  }
  return { groups: SAVED, source: "saved" };
}

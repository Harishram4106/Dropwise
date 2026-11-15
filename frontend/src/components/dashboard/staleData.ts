"use client";

// The stale-factor demo: GET /demo/stale-factor. Offline it returns its captured result; `?live=1` would search for
// real (not used here). Demo mode, or an unreachable API, uses the saved copy.

import saved from "@/fixtures/stale-factor.json";
import { INTELLIGENCE_URL, type StaleDemo } from "@/lib/dropwise";

const SAVED = saved as unknown as StaleDemo;

export async function fetchStale(live: boolean): Promise<{ demo: StaleDemo; source: "live" | "saved" }> {
  if (live) {
    try {
      const res = await fetch(`${INTELLIGENCE_URL}/demo/stale-factor`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.ok) return { demo: (await res.json()) as StaleDemo, source: "live" };
    } catch {
      // fall back to the saved copy
    }
  }
  return { demo: SAVED, source: "saved" };
}

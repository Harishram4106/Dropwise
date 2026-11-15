"use client";

// The claim checker's data: POST /claims/check on the intelligence API (offline and keyless: rules split the claim and
// the signed registry judges each part; a model and live Tavily sources are added automatically when keys are set).
// Demo mode, or an unreachable API, uses saved results; only the saved sample claims can be checked then.

import saved from "@/fixtures/claims.json";
import { type ClaimResult, INTELLIGENCE_URL } from "@/lib/dropwise";

export interface SampleClaim {
  claim: string;
  result: ClaimResult;
}

export const SAMPLES: SampleClaim[] = (saved as unknown as { claims: SampleClaim[] }).claims;

export class NotCheckable extends Error {}

export type Checked = { result: ClaimResult; source: "live" | "saved" };

export async function checkClaim(claim: string, live: boolean): Promise<Checked> {
  const text = claim.trim();
  if (live) {
    try {
      const res = await fetch(`${INTELLIGENCE_URL}/claims/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: text }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { result: (await res.json()) as ClaimResult, source: "live" };
      if (res.status === 400) throw new NotCheckable((await res.json().catch(() => ({ error: "" }))).error || "The claim checker couldn't read that.");
    } catch (err) {
      if (err instanceof NotCheckable) throw err;
    }
  }
  const hit = SAMPLES.find((s) => s.claim === text);
  if (hit) return { result: hit.result, source: "saved" };
  throw new NotCheckable(
    live
      ? `The intelligence API isn't answering at ${INTELLIGENCE_URL}. Start it with "npm run serve" in intelligence/, or try one of the sample claims.`
      : "Demo data can only check the sample claims. Start the intelligence API and open this page without ?demo=1 to check any claim.",
  );
}

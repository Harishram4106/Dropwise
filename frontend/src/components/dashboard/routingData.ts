"use client";

// The routing page's data: classify a prompt (POST /route/classify) and the classifier's eval scores
// (GET /eval/routing). Both are offline in the intelligence API: rules only, no keys, no model.
// Demo mode, or an unreachable API, uses saved copies; only the saved sample prompts can be classified then.

import { useEffect, useState } from "react";
import saved from "@/fixtures/routing.json";
import { INTELLIGENCE_URL, type RouteDecision, type RoutingEval } from "@/lib/dropwise";
import { useConnection } from "./connection";

export interface Sample {
  prompt: string;
  decision: RouteDecision;
}

const FIXTURE = saved as unknown as { samples: Sample[]; eval: RoutingEval };
export const SAMPLES: Sample[] = FIXTURE.samples;

export type Classified = { decision: RouteDecision; source: "live" | "saved" };

const savedFor = (prompt: string) => SAMPLES.find((s) => s.prompt === prompt.trim());

export class NotClassifiable extends Error {}

/** Live when the intelligence API answers; otherwise the saved decision, if this is one of the samples. */
export async function classifyPrompt(prompt: string, live: boolean): Promise<Classified> {
  const text = prompt.trim();
  if (live) {
    try {
      const res = await fetch(`${INTELLIGENCE_URL}/route/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return { decision: (await res.json()) as RouteDecision, source: "live" };
      if (res.status === 400) throw new NotClassifiable((await res.json().catch(() => ({ error: "" }))).error || "The classifier couldn't read that prompt.");
    } catch (err) {
      if (err instanceof NotClassifiable) throw err;
      // fall through to the saved copy
    }
  }
  const hit = savedFor(text);
  if (hit) return { decision: hit.decision, source: "saved" };
  throw new NotClassifiable(
    live
      ? `The intelligence API isn't answering at ${INTELLIGENCE_URL}. Start it with "npm run serve" in intelligence/, or try one of the sample prompts.`
      : "Demo data can only classify the sample prompts. Start the intelligence API and open this page without ?demo=1 to try any prompt.",
  );
}

/** The routing eval: live when the API answers, otherwise the saved copy. */
export function useRoutingEval(): { report: RoutingEval; source: "live" | "saved" } {
  const { status } = useConnection();
  const [live, setLive] = useState<RoutingEval | null>(null);
  useEffect(() => {
    if (status !== "live") return;
    let stopped = false;
    fetch(`${INTELLIGENCE_URL}/eval/routing`, { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<RoutingEval>) : Promise.reject(new Error(String(r.status)))))
      .then((report) => !stopped && setLive(report))
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [status]);
  return status === "live" && live ? { report: live, source: "live" } : { report: FIXTURE.eval, source: "saved" };
}

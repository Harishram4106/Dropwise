import type { AtomicClaim, Counts, Range, Verdict } from "../contracts.ts";
import type { Atomic } from "./decompose.ts";
import { detectPer, parseQuantity, type Quantity } from "./quantity.ts";

export interface Evidence {
  label: string;
  short: string;
  range: Range;
  unit: string;
  counts: Counts;
  source_url: string;
  source_date: string;
  freshness_score: number;
  stale: boolean;
  subjects: string[];
  factor_id?: string;
}

// Published figures are rounded; within 1.5x either way counts as agreeing.
export const TOLERANCE = 1.5;

const COUNTS_LABEL: Record<Counts, string> = {
  direct_only: "on-site water only",
  indirect_only: "electricity water only",
  direct_plus_indirect: "on-site plus electricity water",
  unclear: "scope not stated",
  not_applicable: "energy",
};

export function perResponseKind(unit: string): "water" | "energy" | null {
  const m = /^(ml|wh)\s+per\s+(prompt|query|response)\b/i.exec(unit.trim());
  if (!m) return null;
  return m[1].toLowerCase() === "ml" ? "water" : "energy";
}

export function agrees(claimed: Range, evidence: Range): boolean {
  return claimed.low <= evidence.high * TOLERANCE && claimed.high >= evidence.low / TOLERANCE;
}

function mentions(text: string, subject: string): boolean {
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i").test(text);
}

export function relevantEvidence(atomic: Atomic, quantity: Quantity, evidence: Evidence[]): Evidence[] {
  const sameKind = evidence.filter((e) => perResponseKind(e.unit) === quantity.kind);
  const subjectText = `${atomic.text} ${atomic.context}`;
  const named = sameKind.filter((e) => e.subjects.some((s) => mentions(subjectText, s)));
  return named.length > 0 ? named : sameKind;
}

export function judge(atomic: Atomic, evidence: Evidence[]): AtomicClaim {
  const quantity = parseQuantity(atomic.text) ?? parseQuantity(atomic.context);
  const base = { text: atomic.text, counts: atomic.counts, claimed: null, freshness_score: 0, sources: [], registry_factors: [] };

  if (!quantity) {
    return { ...base, verdict: "unsupported", explanation: "The claim states no figure, so there is nothing to check against sources." };
  }
  const per = quantity.per ?? detectPer(atomic.context);
  const claimed = { low: quantity.low, high: quantity.high, unit: `${quantity.unit} per ${per ?? "unspecified"}` };

  if (per !== "response") {
    const what = per === "conversation" ? "per conversation" : "without saying per what";
    return { ...base, claimed, verdict: "unsupported", explanation: `The claim gives a figure ${what}; published figures are per prompt or response, so they can't be compared.` };
  }

  const relevant = relevantEvidence(atomic, quantity, evidence);
  if (relevant.length === 0) {
    return { ...base, claimed, verdict: "unsupported", explanation: `The registry has no ${quantity.kind} figures per prompt to compare with.` };
  }

  const claimedRange = { low: quantity.low, high: quantity.high };
  const agreeing = relevant.filter((e) => agrees(claimedRange, e.range));
  const highest = relevant.reduce((a, b) => (b.range.high > a.range.high ? b : a));
  const lowest = relevant.reduce((a, b) => (b.range.low < a.range.low ? b : a));
  const fresh = agreeing.filter((e) => !e.stale);

  let verdict: Verdict;
  let lead: string;
  let cited: Evidence[] = agreeing;
  if (fresh.length > 0) {
    verdict = "supported";
    lead = `Consistent with ${list(fresh)}.`;
  } else if (agreeing.length > 0) {
    verdict = "outdated";
    lead = `Matches only ${list(agreeing)}, which a newer source has superseded.`;
  } else if (claimedRange.low > highest.range.high * TOLERANCE) {
    verdict = "overstated";
    lead = `About ${times(claimedRange.low / highest.range.high)} the highest published estimate, ${describe(highest)}.`;
    cited = [highest];
  } else if (claimedRange.high < lowest.range.low / TOLERANCE) {
    verdict = "understated";
    lead = `About ${times(lowest.range.low / claimedRange.high)} below the lowest published estimate, ${describe(lowest)}.`;
    cited = [lowest];
  } else {
    verdict = "unsupported";
    lead = `No source states this figure; it falls between published estimates.`;
  }

  const others = relevant.filter((e) => !cited.includes(e));
  const context = others.length > 0 ? ` Other published figures: ${others.map(describe).join("; ")}.` : "";

  return {
    text: atomic.text,
    counts: atomic.counts,
    claimed,
    verdict,
    explanation: `Claim: ${fmtRange(claimedRange)} ${claimed.unit}. ${lead}${context}`,
    freshness_score: Math.max(...relevant.map((e) => e.freshness_score)),
    sources: [...new Set(relevant.map((e) => e.source_url))],
    registry_factors: relevant.flatMap((e) => (e.factor_id ? [e.factor_id] : [])),
  };
}

function describe(e: Evidence): string {
  return `${fmtRange(e.range)} ${e.unit} (${e.short}, ${COUNTS_LABEL[e.counts]})`;
}

function list(items: Evidence[]): string {
  return items.map(describe).join(" and ");
}

function times(ratio: number): string {
  return ratio >= 10 ? `${Math.round(ratio).toLocaleString("en-US")}x` : `${ratio.toFixed(1)}x`;
}

export function fmt(n: number): string {
  if (n >= 10) return Math.round(n).toLocaleString("en-US");
  if (n >= 1) return n.toFixed(1).replace(/\.0$/, "");
  return Number(n.toPrecision(2)).toString();
}

function fmtRange({ low, high }: Range): string {
  return low === high ? fmt(low) : `${fmt(low)}–${fmt(high)}`;
}

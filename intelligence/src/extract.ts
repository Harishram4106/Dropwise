import type { Candidate, Counts, FactorSpec } from "./contracts.ts";
import { chatJSON } from "./bifrost.ts";
import type { TavilyResult } from "./tavily.ts";

const COUNTS: Counts[] = ["direct_only", "indirect_only", "direct_plus_indirect", "unclear", "not_applicable"];
const UNIT_HINT = /\b(m?l|millilit(?:er|re)s?|lit(?:er|re)s?|gallons?|wh|kwh|watt[- ]hours?|l\/kwh|teaspoon|bottle)\b/i;

// Only sentences with a number and a unit go to the model, which keeps extraction cheap.
export function candidateSentences(text: string, limit = 12): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /\d/.test(s) && UNIT_HINT.test(s))
    .slice(0, limit);
}

const SYSTEM_PROMPT = `You extract one quantitative figure from source text for an evidence registry about the water and energy footprint of AI.
Rules:
- Report only numbers the text states. Do not estimate, average, or combine figures. Unit conversion is allowed only when the text gives both units.
- "evidence" must be an exact, verbatim quote from the text that contains the figure.
- counts: "direct_only" = on-site data-center cooling water; "indirect_only" = water consumed generating the electricity; "direct_plus_indirect" = both (including lifecycle studies); "unclear" = the source does not say; "not_applicable" = not a water figure.
- source_date: the publication date stated in the text as YYYY-MM-DD, YYYY-MM or YYYY, or null if not stated.
Reply with JSON only: {"found": boolean, "value": number|null, "low": number, "high": number, "unit": string, "counts": string, "source_date": string|null, "evidence": string}`;

export async function extractFigure(spec: FactorSpec, result: TavilyResult, now = new Date()): Promise<Candidate | null> {
  const sentences = candidateSentences(result.content);
  if (sentences.length === 0) return null;

  const raw = await chatJSON([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Factor wanted: ${spec.label}\nExpected unit: ${spec.unit}\nSource title: ${result.title}\nSource published: ${result.published_date ?? "unknown"}\n\nText:\n${sentences.join("\n")}`,
    },
  ]);
  return parseExtraction(raw, spec, result, now);
}

// Rejects anything the model could have invented: the quote must appear in the source text.
export function parseExtraction(raw: unknown, spec: FactorSpec, result: TavilyResult, now = new Date()): Candidate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.found !== true) return null;

  const low = Number(r.low);
  const high = Number(r.high);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || low > high) return null;

  const value = r.value === null || r.value === undefined ? null : Number(r.value);
  if (value !== null && (!Number.isFinite(value) || value < low || value > high)) return null;

  const evidence = typeof r.evidence === "string" ? r.evidence.trim() : "";
  if (!evidence || !normalize(result.content).includes(normalize(evidence))) return null;

  const counts = COUNTS.includes(r.counts as Counts) ? (r.counts as Counts) : "unclear";
  let sourceDate = pickDate(r.source_date, result.published_date);
  // Last resort: a date written into the source's own address, e.g. /2024-12/. Marked, so a reviewer sees it was inferred.
  const fromUrl = sourceDate ? null : dateFromUrl(result.url, now);
  if (!sourceDate) sourceDate = fromUrl;
  if (!sourceDate) return null;

  return {
    factor_id: spec.factor_id,
    value,
    range: { low, high },
    unit: typeof r.unit === "string" && r.unit ? r.unit : spec.unit,
    counts,
    source_url: result.url,
    source_title: result.title,
    source_date: sourceDate,
    ...(fromUrl ? { source_date_inferred: "url" as const } : {}),
    evidence,
    found_at: now.toISOString(),
  };
}

/** A year-month (or full date) in the URL path, as in /sites/default/files/2024-12/report.pdf or /2025/03/14/post. Null if none looks real. */
export function dateFromUrl(url: string, now = new Date()): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = /(?:^|\/)((?:19|20)\d{2})[-/](0[1-9]|1[0-2])(?:[-/](0[1-9]|[12]\d|3[01]))?(?=\/|$|[._-])/.exec(path);
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(year) > now.getUTCFullYear()) return null;
  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function pickDate(...options: unknown[]): string | null {
  for (const d of options) {
    if (typeof d !== "string") continue;
    const match = /^\d{4}(-\d{2}(-\d{2})?)?/.exec(d.trim());
    if (match) return match[0];
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

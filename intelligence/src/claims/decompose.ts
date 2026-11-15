import type { Counts } from "../contracts.ts";
import { chatJSON } from "../bifrost.ts";
import { parseQuantity, UNIT_WORD_RE } from "./quantity.ts";

export interface Atomic {
  text: string;
  // The sentence the atomic claim came from, used to recover the subject or "per query" it omits.
  context: string;
  counts: Counts;
}

const COUNTS: Counts[] = ["direct_only", "indirect_only", "direct_plus_indirect", "unclear", "not_applicable"];

export function classifyCounts(text: string): Counts {
  const t = text.toLowerCase();
  if (!/\bwater\b/.test(t) && /\b(wh|kwh|watt[- ]hours?|energy)\b/.test(t)) return "not_applicable";
  if (/\b(lifecycle|life cycle|life-cycle|total footprint|including (the )?electricity|on-site and off-site)\b/.test(t)) return "direct_plus_indirect";
  const direct = /\b(cool(ing|s|ed)?|evaporat\w*|on-site|onsite)\b/.test(t);
  const indirect = /\b(electricity|power plants?|power generation|off-site|offsite|grid)\b/.test(t);
  if (direct && indirect) return "direct_plus_indirect";
  if (direct) return "direct_only";
  if (indirect) return "indirect_only";
  return "unclear";
}

const CONNECTOR = /\s*;\s*|,?\s+(?:and|while|but|whereas)\s+/i;
const VERB = /^(.*?\b(?:uses?|needs?|consumes?|requires?|takes?|drinks?|costs?|equals?)\b)/i;

// "X uses a bottle and 3 Wh" → the second part becomes "X uses 3 Wh".
function withSubject(part: string, first: string): string {
  if (VERB.test(part)) return part;
  const subject = VERB.exec(first)?.[1];
  return subject ? `${subject} ${part}` : part;
}

// Splits only where both sides carry their own figure, so "uses a bottle of water and cooling" stays whole.
export function decomposeByRules(claim: string): Atomic[] {
  const sentences = claim
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const atomics: Atomic[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(CONNECTOR).map((p) => p.trim()).filter(Boolean);
    const quantified = parts.filter((p) => parseQuantity(p) !== null);
    const pieces = parts.length > 1 && quantified.length === parts.length ? parts.map((p) => withSubject(p, parts[0])) : [sentence];
    for (const text of pieces) atomics.push({ text: text.replace(/[.!?]$/, ""), context: sentence, counts: classifyCounts(text) });
  }
  return atomics;
}

const SYSTEM_PROMPT = `Split a claim about AI's water or energy use into atomic claims, each checkable on its own.
Rules:
- Each atomic claim must be self-contained: repeat the subject (e.g. "a ChatGPT query") instead of using pronouns.
- Keep every number and unit exactly as written. Never convert units, compute, or add figures.
- counts: "direct_only" = on-site data-center cooling water; "indirect_only" = water behind the electricity; "direct_plus_indirect" = both or lifecycle; "unclear" = not stated; "not_applicable" = not about water.
Reply with JSON only: {"atomic_claims": [{"text": string, "counts": string}]}`;

export async function decomposeWithModel(claim: string): Promise<Atomic[]> {
  const raw = (await chatJSON([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: claim },
  ])) as { atomic_claims?: { text?: unknown; counts?: unknown }[] };

  const items = Array.isArray(raw.atomic_claims) ? raw.atomic_claims : [];
  const atomics = items
    .filter((i): i is { text: string; counts?: unknown } => typeof i.text === "string" && i.text.trim().length > 0)
    .map((i) => ({
      text: i.text.trim(),
      context: claim,
      counts: COUNTS.includes(i.counts as Counts) ? (i.counts as Counts) : classifyCounts(i.text),
    }));

  if (atomics.length === 0) throw new Error("Model returned no atomic claims");
  const invented = atomics.find((a) => !onlyUsesClaimFigures(a.text, claim));
  if (invented) throw new Error(`Model introduced a figure not in the claim: "${invented.text}"`);
  return atomics;
}

// Every number and unit word in an atomic claim must already appear in the original claim.
export function onlyUsesClaimFigures(atomic: string, claim: string): boolean {
  const numbers = (s: string) => new Set(s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []);
  const units = (s: string) => new Set((s.match(UNIT_WORD_RE) ?? []).map((u) => u.toLowerCase()));
  const claimNumbers = numbers(claim);
  const claimUnits = units(claim);
  return [...numbers(atomic)].every((n) => claimNumbers.has(n)) && [...units(atomic)].every((u) => claimUnits.has(u));
}

export async function decompose(claim: string, { useModel }: { useModel: boolean }): Promise<{ atomics: Atomic[]; method: "model" | "rules"; warning?: string }> {
  if (useModel) {
    try {
      return { atomics: await decomposeWithModel(claim), method: "model" };
    } catch (err) {
      return { atomics: decomposeByRules(claim), method: "rules", warning: `Model decomposition failed, used rules: ${(err as Error).message}` };
    }
  }
  return { atomics: decomposeByRules(claim), method: "rules" };
}

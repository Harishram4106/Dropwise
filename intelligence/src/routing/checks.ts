// Deterministic answer checks for the quality evaluation. No model grades another model's
// answer: each item says exactly what a correct answer must contain.

export type AnswerCheck =
  // Every entry must appear (case-insensitive); an array entry means any one of its strings.
  | { type: "contains"; all: (string | string[])[]; scope?: Scope }
  | { type: "regex"; all: string[]; flags?: string; scope?: Scope }
  // Some number in the answer equals the value (or one of the values) within the tolerance.
  | { type: "number"; value: number | number[]; tolerance?: number; scope?: Scope }
  // Exactly one of the options is named, and it is the right one.
  | { type: "choice"; options: string[]; value: string; scope?: Scope }
  | { type: "json"; equals: Record<string, unknown> }
  | { type: "min_words"; value: number }
  | { type: "none"; reason: string };

// "answer" checks only the final 'Answer:' line (so working-out can't pass by accident);
// "full" checks the whole reply (for explanations, where the key terms sit in the body).
type Scope = "answer" | "full";

export function finalAnswer(text: string): string {
  const matches = [...text.matchAll(/^[\s>*_#-]*answer\s*\**\s*[:：]/gim)];
  const last = matches.at(-1);
  return last === undefined ? text : text.slice((last.index ?? 0) + last[0].length).trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");

function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,(?=\d{3}\b)/g, "")))
    .filter((n) => Number.isFinite(n));
}

function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// true/false for checkable items, null when the item can't be scored (time-sensitive answers).
export function scoreAnswer(check: AnswerCheck, reply: string): boolean | null {
  switch (check.type) {
    case "none":
      return null;
    case "min_words":
      return reply.split(/\s+/).filter(Boolean).length >= check.value;
    case "json": {
      const parsed = jsonIn(reply) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") return false;
      return Object.entries(check.equals).every(([k, v]) => JSON.stringify(parsed[k]) === JSON.stringify(v));
    }
  }

  const text = check.scope === "full" ? reply : finalAnswer(reply);
  switch (check.type) {
    case "contains": {
      const hay = norm(text);
      return check.all.every((entry) => (Array.isArray(entry) ? entry : [entry]).some((s) => hay.includes(norm(s))));
    }
    case "regex":
      return check.all.every((p) => new RegExp(p, check.flags ?? "i").test(text));
    case "number": {
      const targets = Array.isArray(check.value) ? check.value : [check.value];
      const tolerance = check.tolerance ?? 1e-9;
      return numbersIn(text).some((n) => targets.some((t) => Math.abs(n - t) <= tolerance));
    }
    case "choice": {
      const named = check.options.filter((o) => new RegExp(`\\b${o}\\b`, "i").test(text));
      return named.length === 1 && named[0].toLowerCase() === check.value.toLowerCase();
    }
  }
}

export function validateCheck(check: AnswerCheck): string[] {
  const problems: string[] = [];
  if (check.type === "regex") {
    for (const p of check.all) {
      try {
        new RegExp(p, check.flags ?? "i");
      } catch (err) {
        problems.push(`bad regex ${p}: ${(err as Error).message}`);
      }
    }
  }
  if (check.type === "choice" && !check.options.includes(check.value)) problems.push(`choice value ${check.value} not in options`);
  if (check.type === "contains" && !check.all.length) problems.push("contains check with nothing to find");
  return problems;
}

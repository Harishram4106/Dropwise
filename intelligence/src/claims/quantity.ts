export type QuantityKind = "water" | "energy";
export type Per = "response" | "conversation" | null;

export interface Quantity {
  kind: QuantityKind;
  low: number;
  high: number;
  unit: "mL" | "Wh";
  per: Per;
  raw: string;
}

// Household measures are converted to mL; "bottle" is the 500 mL bottle the viral claim refers to.
const UNITS: { pattern: string; kind: QuantityKind; factor: number }[] = [
  { pattern: "kwh|kilowatt[- ]hours?", kind: "energy", factor: 1000 },
  { pattern: "mwh|milliwatt[- ]hours?", kind: "energy", factor: 0.001 },
  { pattern: "wh|watt[- ]hours?", kind: "energy", factor: 1 },
  { pattern: "ml|millilit(?:er|re)s?", kind: "water", factor: 1 },
  { pattern: "l|lit(?:er|re)s?", kind: "water", factor: 1000 },
  { pattern: "gallons?|gal", kind: "water", factor: 3785.41 },
  { pattern: "(?:fl\\.?\\s*)?(?:oz|ounces?)", kind: "water", factor: 29.57 },
  { pattern: "teaspoons?|tsp", kind: "water", factor: 4.93 },
  { pattern: "tablespoons?|tbsp", kind: "water", factor: 14.79 },
  { pattern: "cups?", kind: "water", factor: 240 },
  { pattern: "glass(?:es)?", kind: "water", factor: 250 },
  { pattern: "(?:water\\s+)?bottles?", kind: "water", factor: 500 },
  { pattern: "drops?", kind: "water", factor: 0.05 },
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50, hundred: 100,
};

const FRACTIONS: Record<string, number> = {
  half: 2, third: 3, quarter: 4, fourth: 4, fifth: 5, tenth: 10,
  fifteenth: 15, twentieth: 20, fiftieth: 50, hundredth: 100,
};

// Word numbers must be whole words followed by a space, so "total" never reads as "a l" (1 litre).
const WORDS = `(?<![\\w.])(?:${Object.keys(WORD_NUMBERS).join("|")})(?=\\s)`;
const NUMBER = `((?<![\\w.])\\d[\\d,]*(?:\\.\\d+)?|${WORDS})`;
const RANGE = `${NUMBER}(?:\\s*(?:-|–|to)\\s*${NUMBER})?`;
const UNIT_ALT = UNITS.map((u) => u.pattern).join("|");
const FRACTION = `(?:(?:(${WORDS})\\s+)?(?<![\\w.])(${Object.keys(FRACTIONS).join("|")})s?\\s+(?:of\\s+)?)?`;

const QUANTITY_RE = new RegExp(
  `(?:between\\s+${NUMBER}\\s+and\\s+${NUMBER}|${FRACTION}${RANGE})\\s*(${UNIT_ALT})\\b`,
  "i",
);

const PER_WORDS = "queries|query|prompts?|questions?|requests?|responses?|answers?|replies|reply|messages?|emails?|searches|search";
const DIVISOR_RE = new RegExp(
  `\\b(?:for|per|every)\\s+(?:roughly\\s+|about\\s+|around\\s+|every\\s+)?${RANGE}\\s+(?:[a-z-]+\\s+){0,2}(?:${PER_WORDS})\\b`,
  "i",
);

function toNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word !== undefined) return word;
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unitFor(token: string): { kind: QuantityKind; factor: number } {
  const found = UNITS.find((u) => new RegExp(`^(?:${u.pattern})$`, "i").test(token.trim()));
  if (!found) throw new Error(`Unknown unit ${token}`);
  return found;
}

export function detectPer(text: string): Per {
  if (/\b(conversations?|chat sessions?)\b/i.test(text)) return "conversation";
  if (new RegExp(`\\b(${PER_WORDS})\\b`, "i").test(text)) return "response";
  return null;
}

export function parseQuantity(text: string): Quantity | null {
  const m = QUANTITY_RE.exec(text);
  if (!m) return null;
  const [raw, betweenLow, betweenHigh, fracCount, fracWord, low, high, unitToken] = m;

  let lo: number | null;
  let hi: number | null;
  if (betweenLow !== undefined) {
    lo = toNumber(betweenLow);
    hi = toNumber(betweenHigh);
  } else {
    lo = toNumber(low);
    hi = toNumber(high) ?? lo;
    if (fracWord && lo !== null && hi !== null) {
      const share = (toNumber(fracCount) ?? 1) / FRACTIONS[fracWord.toLowerCase()];
      lo *= share;
      hi *= share;
    }
  }
  if (lo === null || hi === null) return null;

  const { kind, factor } = unitFor(unitToken);
  let scaledLow = Math.min(lo, hi) * factor;
  let scaledHigh = Math.max(lo, hi) * factor;
  let per = detectPer(text);

  // "a bottle for 10-50 responses" means 10-50 mL per response, not 500 mL per response.
  const divisor = DIVISOR_RE.exec(text.slice(m.index + raw.length));
  if (divisor) {
    const dLow = toNumber(divisor[1]);
    const dHigh = toNumber(divisor[2]) ?? dLow;
    if (dLow && dHigh) {
      [scaledLow, scaledHigh] = [scaledLow / Math.max(dLow, dHigh), scaledHigh / Math.min(dLow, dHigh)];
      per = "response";
    }
  }

  return { kind, low: round(scaledLow), high: round(scaledHigh), unit: kind === "water" ? "mL" : "Wh", per, raw: raw.trim() };
}

function round(n: number): number {
  return Number(n.toPrecision(4));
}

export const UNIT_WORD_RE = new RegExp(`\\b(${UNIT_ALT})\\b`, "gi");

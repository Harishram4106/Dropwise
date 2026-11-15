// Right-sizing classifier: decides whether a request can go to a smaller model.
//
// It is deliberately conservative. A request goes small only when it shows a clear easy-task
// signal (a short lookup, a conversion, a small rewrite) AND no hard-task signal (code, maths,
// multi-step reasoning, analysis, long-form writing, legal or medical stakes, long context,
// images, tools). Anything unclear stays on the large model. Sending an easy prompt to the large
// model only costs savings; sending a hard prompt to the small model costs answer quality, which
// is the risk the plan names.
//
// Rules only, no model call: this runs inside the gateway on every request, and the benchmark
// reports the latency it adds.

import type { RouteDecision, Tier } from "../contracts.ts";
import { approxTokens, hasImage, instructionOf, lastUserText, messagesOf, type ClassifyInput } from "./text.ts";
import { timeSensitivity } from "./timeliness.ts";

export const CLASSIFIER_VERSION = "rules-1";
export const MIN_SMALL_CONFIDENCE = 0.7;
const LONG_CONTEXT_TOKENS = 2000;
const SHORT_LOOKUP_WORDS = 20;

interface Features {
  text: string; // last user message as sent
  instruction: string; // the same, without code blocks and long quoted passages
  words: number;
  numbers: number;
  contextTokens: number;
  userTurns: number;
}

interface Signal {
  id: string;
  kind: "hard" | "easy";
  reason: string;
  test: (f: Features) => boolean;
}

const has = (re: RegExp) => (f: Features) => re.test(f.instruction);

const SIGNALS: Signal[] = [
  // Hard: any one of these keeps the request on the large model.
  {
    id: "code",
    kind: "hard",
    reason: "contains or asks for code",
    test: (f) =>
      /```/.test(f.text) ||
      /^\s*(def |class |function |import |from \S+ import|#include|SELECT .+ FROM|for \(|if \(|while \(|return\b.*;)|[;{}]\s*$|=>/m.test(f.text) ||
      /\b(code|coding|debug(ging)?|bug|refactor|compile[sd]?|stack ?trace|exception|regex|regular expression|algorithm|programming|sql|api|unit tests?|python|javascript|typescript|java|c\+\+|rust|golang|bash|shell script)\b/i.test(f.instruction),
  },
  {
    id: "math",
    kind: "hard",
    reason: "asks for mathematical reasoning",
    test: (f) =>
      /\b(prove|proof|derive|derivation|theorem|lemma|integral|integrate|derivative|differentiate|equations?|solve for|probability|combinatorics|permutations?|matrix|matrices|eigen\w*|modulo|logarithm|optimi[sz]e|factori[sz]e)\b/i.test(f.instruction) ||
      /\bprimes?\b(?!\s+minister)/i.test(f.instruction) ||
      /\d\s*(\^|\*\*)\s*\d|[√∫∑]/.test(f.instruction),
  },
  {
    id: "puzzle",
    kind: "hard",
    reason: "is a logic puzzle",
    test: has(/\b(puzzle|riddle|knights?|knaves?|always (lies|lie|tells? the truth)|brain ?teaser|trick question)\b/i),
  },
  {
    id: "word_problem",
    kind: "hard",
    reason: "is a multi-step word problem",
    test: (f) =>
      (f.numbers >= 3 && /\?|\b(what|how|which|when)\b/i.test(f.instruction)) ||
      (f.numbers >= 2 &&
        /\b(sum|total|twice|half|times as|more than|less than|each|remaining|left over|altogether|average|ratio|in \d+ (years|days|hours|minutes))\b/i.test(f.instruction)),
  },
  {
    id: "analysis",
    kind: "hard",
    reason: "asks for analysis, comparison or design",
    test: has(
      /\b(analy[sz]e|analysis|compare|comparison|contrast|evaluate|critique|assess|design|architect(ure)?|strategy|strategic|plan for|trade-?offs?|pros and cons|recommend(ation)?|in (depth|detail)|detailed|comprehensive|step[- ]by[- ]step|justify)\b/i,
    ),
  },
  {
    id: "long_form",
    kind: "hard",
    reason: "asks for long-form writing",
    test: (f) =>
      [...f.instruction.matchAll(/\b(\d{3,5})[- ]words?\b/gi)].some((m) => Number(m[1]) >= 300) ||
      /\b(write|draft|compose)\b.{0,40}\b(essay|article|blog post|report|story|chapter|cover letter|proposal|whitepaper|speech)\b/i.test(f.instruction),
  },
  {
    id: "high_stakes",
    kind: "hard",
    reason: "touches on legal, medical or financial advice",
    test: has(
      /\b(legal|lawyer|attorney|lawsuit|sue|court|tenancy|landlord|liabilit\w+|diagnos\w*|symptoms?|dosage|dose|medication|medicine|prescri\w+|drug interactions?|safe to (also )?(take|mix|combine)|side effects?|tax (return|advice|liability)|investment advice|mortgage)\b/i,
    ),
  },
  {
    id: "long_context",
    kind: "hard",
    reason: `has more than ${LONG_CONTEXT_TOKENS} tokens of context`,
    test: (f) => f.contextTokens > LONG_CONTEXT_TOKENS,
  },
  {
    id: "long_conversation",
    kind: "hard",
    reason: "is a long conversation whose earlier turns may matter",
    test: (f) => f.userTurns >= 4,
  },

  // Easy: needed before anything goes small.
  {
    id: "lookup",
    kind: "easy",
    reason: "is a short factual lookup",
    test: (f) =>
      f.words <= SHORT_LOOKUP_WORDS &&
      (/^((at|in|on|by|from) (what|which) |what|who|when|where|which|how (many|much|far|old|long|tall|big))\b/i.test(f.instruction) ||
        /\b(capital of|chemical symbol|stand for|define|definition of|meaning of|synonyms?|antonyms?|how do you (say|spell))\b/i.test(f.instruction)),
  },
  {
    id: "conversion",
    kind: "easy",
    reason: "is a unit conversion or simple arithmetic",
    test: (f) =>
      /\bconvert\b.{0,40}\b(to|into)\b/i.test(f.instruction) ||
      /^(what is |what's |calculate )?-?\d[\d.,]*\s*%?\s*(\+|-|\*|x|×|times|plus|minus|divided by|of)\s*-?\d[\d.,]*\s*\??$/i.test(f.instruction),
  },
  {
    id: "transform",
    kind: "easy",
    reason: "is a small rewrite, extraction or classification",
    test: has(
      /\b((fix|correct|proofread)\b.{0,30}\b(grammar|spelling|typos?|punctuation)|rephrase|paraphrase|reword|rewrite (this|the following)|make (this|it) (more )?(formal|polite|shorter|concise|friendlier|casual)|more formal|translate|summari[sz]e|tl;?dr|extract|classify|categori[sz]e|sentiment|format (this|it|as)|return (only )?json|list the|give (me )?(one|a|an|two|three) )/i,
    ),
  },
  {
    id: "chat",
    kind: "easy",
    reason: "is a greeting or acknowledgement",
    test: has(/^(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening)|ok(ay)?)\b/i),
  },
];

export interface ClassifyOptions {
  // Raise it to send fewer requests small; 0.9 keeps only prompts with two easy signals.
  minConfidence?: number;
  now?: Date;
}

export function classify(input: ClassifyInput, options: ClassifyOptions = {}): RouteDecision {
  const minConfidence = options.minConfidence ?? MIN_SMALL_CONFIDENCE;
  const messages = messagesOf(input);
  const text = lastUserText(messages);
  const instruction = instructionOf(text);
  const timely = timeSensitivity(instruction, options.now);

  const decide = (tier: Tier, confidence: number, signals: string[], reasons: string[]): RouteDecision => ({
    tier,
    confidence: Math.round(confidence * 100) / 100,
    time_sensitive: timely.time_sensitive,
    cache: timely.time_sensitive ? "bypass" : "use",
    signals: [...signals, ...timely.signals],
    reasons: [...reasons, ...timely.reasons.map((r) => `Time-sensitive: ${r}, so the cache is bypassed.`)],
    classifier_version: CLASSIFIER_VERSION,
  });

  // Capabilities a small model may not have: never route these.
  if (hasImage(messages)) return decide("large", 1, ["image"], ["Large model: the request includes an image."]);
  if (Array.isArray(input.tools) && input.tools.length) return decide("large", 1, ["tools"], ["Large model: the request uses tools."]);

  const features: Features = {
    text,
    instruction,
    words: instruction.split(/\s+/).filter(Boolean).length,
    numbers: (instruction.match(/\d+(?:[.,:]\d+)*/g) ?? []).length,
    contextTokens: approxTokens(messages),
    userTurns: messages.filter((m) => m.role === "user").length,
  };

  const hits = SIGNALS.filter((s) => s.test(features));
  const hard = hits.filter((s) => s.kind === "hard");
  const easy = hits.filter((s) => s.kind === "easy");

  if (hard.length) {
    return decide(
      "large",
      hard.length > 1 ? 0.9 : 0.8,
      hard.map((s) => s.id),
      hard.map((s) => `Large model: ${s.reason}.`),
    );
  }
  if (!easy.length) {
    return decide("large", 0.5, [], ["Large model: no clear easy-task signal, so it stays on the default model."]);
  }

  const confidence = easy.length > 1 ? 0.9 : 0.8;
  const reasons = easy.map((s) => `Small model: ${s.reason}.`);
  if (confidence < minConfidence) {
    return decide("large", confidence, easy.map((s) => s.id), [
      ...reasons,
      `Kept on the large model: confidence ${confidence} is below the ${minConfidence} quality guard.`,
    ]);
  }
  return decide("small", confidence, easy.map((s) => s.id), reasons);
}

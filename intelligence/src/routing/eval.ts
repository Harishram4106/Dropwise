// Two evaluations, kept separate on purpose:
//   routing  offline, free: does the classifier pick the labelled tier and spot time-sensitive prompts?
//   quality  through Bifrost: does right-sizing change how many answers pass their checks?
// The quality run is the one the README reports; routing accuracy is a sanity check, because
// the labels were written alongside the rules.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { QualityItemResult, QualityReport, Tier } from "../contracts.ts";
import { canonicalize, sha256 } from "../integrity.ts";
import { EVAL_RESULTS_DIR, EVAL_SET_FILE } from "../paths.ts";
import { scoreAnswer, validateCheck, type AnswerCheck } from "./checks.ts";
import { classify, CLASSIFIER_VERSION, type ClassifyOptions } from "./classify.ts";

export interface EvalItem {
  id: string;
  category: string;
  prompt: string;
  expected_tier: Tier;
  time_sensitive: boolean;
  check: AnswerCheck;
  note?: string;
}

export interface EvalSet {
  description: string;
  system_prompt: string;
  items: EvalItem[];
}

export async function loadEvalSet(file = EVAL_SET_FILE): Promise<EvalSet> {
  const set = JSON.parse(await readFile(file, "utf8")) as EvalSet;
  const problems = validateEvalSet(set);
  if (problems.length) throw new Error(`Invalid eval set:\n${problems.join("\n")}`);
  return set;
}

export function validateEvalSet(set: EvalSet): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of set.items) {
    if (seen.has(item.id)) problems.push(`${item.id}: duplicate id`);
    seen.add(item.id);
    if (item.expected_tier !== "small" && item.expected_tier !== "large") problems.push(`${item.id}: bad expected_tier`);
    if (!item.time_sensitive && item.check.type === "none") problems.push(`${item.id}: evergreen items need a real check`);
    problems.push(...validateCheck(item.check).map((p) => `${item.id}: ${p}`));
  }
  return problems;
}

export const evalSetHash = (set: EvalSet) => sha256(canonicalize(set));

// ---------------------------------------------------------------- routing (offline)

export interface RoutingMistake {
  id: string;
  prompt: string;
  expected: string;
  got: string;
  signals: string[];
}

export interface RoutingReport {
  items: number;
  tier_accuracy: number;
  routed_small_share: number;
  // The number that matters: hard prompts sent to the small model put answer quality at risk.
  hard_routed_small: RoutingMistake[];
  // Costs savings only.
  easy_kept_large: RoutingMistake[];
  time_sensitivity: { precision: number; recall: number; false_positives: RoutingMistake[]; missed: RoutingMistake[] };
  avg_classify_us: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : Math.round((a / b) * 1000) / 1000);

export function evaluateRouting(set: EvalSet, options: ClassifyOptions = {}): RoutingReport {
  const started = process.hrtime.bigint();
  const decisions = set.items.map((item) => ({ item, d: classify({ prompt: item.prompt }, options) }));
  const elapsedUs = Number(process.hrtime.bigint() - started) / 1000;

  const mistake = (item: EvalItem, expected: string, got: string, signals: string[]): RoutingMistake => ({
    id: item.id,
    prompt: item.prompt.length > 90 ? `${item.prompt.slice(0, 87)}...` : item.prompt,
    expected,
    got,
    signals,
  });

  const hard = decisions.filter(({ item, d }) => item.expected_tier === "large" && d.tier === "small");
  const easy = decisions.filter(({ item, d }) => item.expected_tier === "small" && d.tier === "large");
  const fp = decisions.filter(({ item, d }) => !item.time_sensitive && d.time_sensitive);
  const fn = decisions.filter(({ item, d }) => item.time_sensitive && !d.time_sensitive);
  const flagged = decisions.filter(({ d }) => d.time_sensitive).length;
  const actual = set.items.filter((i) => i.time_sensitive).length;

  return {
    items: set.items.length,
    tier_accuracy: ratio(decisions.filter(({ item, d }) => item.expected_tier === d.tier).length, decisions.length),
    routed_small_share: ratio(decisions.filter(({ d }) => d.tier === "small").length, decisions.length),
    hard_routed_small: hard.map(({ item, d }) => mistake(item, "large", "small", d.signals)),
    easy_kept_large: easy.map(({ item, d }) => mistake(item, "small", "large", d.signals)),
    time_sensitivity: {
      precision: ratio(flagged - fp.length, flagged),
      recall: ratio(actual - fn.length, actual),
      false_positives: fp.map(({ item, d }) => mistake(item, "evergreen", "time-sensitive", d.signals)),
      missed: fn.map(({ item, d }) => mistake(item, "time-sensitive", "evergreen", d.signals)),
    },
    avg_classify_us: Math.round((elapsedUs / decisions.length) * 10) / 10,
  };
}

// ---------------------------------------------------------------- quality (through Bifrost)

export type Answerer = (model: string, system: string, prompt: string) => Promise<string>;

export interface QualityOptions extends ClassifyOptions {
  small: string;
  large: string;
  answer: Answerer;
  maxDropPts?: number;
  concurrency?: number;
  now?: Date;
}

export const DEFAULT_MAX_DROP_PTS = 5;

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Every checkable item is answered by both models. The routed configuration then uses the small
// model's answer where the classifier chose small and the large model's elsewhere, so it costs
// no extra calls, and "all small" shows what the classifier protects against.
export async function evaluateQuality(set: EvalSet, options: QualityOptions): Promise<QualityReport> {
  const maxDrop = options.maxDropPts ?? DEFAULT_MAX_DROP_PTS;
  const items = set.items.filter((i) => i.check.type !== "none");

  const results = await pool(items, options.concurrency ?? 4, async (item): Promise<QualityItemResult> => {
    const tier = classify({ prompt: item.prompt }, options).tier;
    const [large, small] = await Promise.all([
      options.answer(options.large, set.system_prompt, item.prompt),
      options.answer(options.small, set.system_prompt, item.prompt),
    ]);
    const largePass = scoreAnswer(item.check, large) === true;
    const smallPass = scoreAnswer(item.check, small) === true;
    return {
      id: item.id,
      tier,
      large_pass: largePass,
      routed_pass: tier === "small" ? smallPass : largePass,
      small_pass: smallPass,
      answers: { large: large.slice(0, 2000), small: small.slice(0, 2000) },
    };
  });

  const rate = (key: "large_pass" | "routed_pass" | "small_pass") => ratio(results.filter((r) => r[key]).length, results.length);
  const passRate = { all_large: rate("large_pass"), routed: rate("routed_pass"), all_small: rate("small_pass") };
  const drop = Math.round((passRate.all_large - passRate.routed) * 1000) / 10;
  const guard = drop <= maxDrop ? "pass" : "fail";

  return {
    created_at: (options.now ?? new Date()).toISOString(),
    eval_set_hash: evalSetHash(set),
    classifier_version: CLASSIFIER_VERSION,
    small_model: options.small,
    large_model: options.large,
    method:
      "Each checkable prompt is answered by both models through Bifrost (provider-default sampling: current Claude models reject temperature settings) and scored by a deterministic check (expected value, phrase, pattern or JSON fields; no model grading). 'routed' uses the small model's answer only where the classifier chose small.",
    items_scored: results.length,
    routed_small_share: ratio(results.filter((r) => r.tier === "small").length, results.length),
    pass_rate: passRate,
    quality_drop_pts: drop,
    max_drop_pts: maxDrop,
    guard,
    recommendation:
      guard === "pass"
        ? `Right-sizing kept answer quality within ${maxDrop} points of the large model, so routing can stay on.`
        : `Right-sizing lost ${drop} points of answer quality (limit ${maxDrop}). Turn routing off and rely on caching and budgets until the classifier is fixed.`,
    lost: results.filter((r) => r.large_pass && !r.routed_pass).map((r) => r.id),
    results,
  };
}

export async function saveQualityReport(report: QualityReport, dir = EVAL_RESULTS_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const file = join(dir, `quality-${report.created_at.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, body);
  await writeFile(join(dir, "latest.json"), body);
  return file;
}

export async function loadLatestQualityReport(dir = EVAL_RESULTS_DIR): Promise<QualityReport | null> {
  try {
    return JSON.parse(await readFile(join(dir, "latest.json"), "utf8")) as QualityReport;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

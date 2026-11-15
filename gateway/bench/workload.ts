// Benchmark workload: the 150 prompts in prompts.json, expanded into a fixed 200-request sequence.
//
// Every prompt is sent once, in a seeded random order, and 50 of them are sent a second time, word for
// word, somewhere after their first appearance. Repeats are drawn in proportion to each category
// (25 easy, 20 hard, 5 time-sensitive), so every prompt is equally likely to come back. The repeat share
// (25%) is a stated assumption about traffic, not a measurement: cache savings scale with it.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Category = "easy" | "hard" | "time_sensitive";
export const CATEGORIES: Category[] = ["easy", "hard", "time_sensitive"];

export interface BenchPrompt {
  id: string;
  category: Category;
  text: string;
}

export interface PromptSet {
  description: string;
  system_prompt: string;
  prompts: BenchPrompt[];
}

export interface WorkloadItem {
  index: number;
  id: string;
  category: Category;
  text: string;
  /** True for the second, word-for-word sending of a prompt already sent earlier in the sequence. */
  repeat: boolean;
}

export interface Composition {
  requests: number;
  unique_prompts: number;
  repeats: number;
  repeat_share: number;
  by_category: Record<Category, { requests: number; repeats: number }>;
}

export interface Workload {
  seed: number;
  system_prompt: string;
  items: WorkloadItem[];
  composition: Composition;
  /** sha256 of the system prompt and the request sequence, so results name exactly what was sent. */
  hash: string;
}

export const PROMPTS_FILE = fileURLToPath(new URL("./prompts.json", import.meta.url));
export const DEFAULT_SEED = 7;
export const DEFAULT_REPEATS: Record<Category, number> = { easy: 25, hard: 20, time_sensitive: 5 };

export async function loadPromptSet(file = PROMPTS_FILE): Promise<PromptSet> {
  const set = JSON.parse(await readFile(file, "utf8")) as PromptSet;
  const ids = new Set<string>();
  for (const p of set.prompts) {
    if (ids.has(p.id)) throw new Error(`Duplicate prompt id ${p.id}`);
    if (!CATEGORIES.includes(p.category)) throw new Error(`Prompt ${p.id} has unknown category ${p.category}`);
    if (!p.text?.trim()) throw new Error(`Prompt ${p.id} is empty`);
    ids.add(p.id);
  }
  return set;
}

/** Small, fast, seedable PRNG (mulberry32), so the sequence is identical on every machine. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildWorkload(
  set: PromptSet,
  options: { seed?: number; repeats?: Record<Category, number>; limit?: number } = {},
): Workload {
  const seed = options.seed ?? DEFAULT_SEED;
  const repeats = options.repeats ?? DEFAULT_REPEATS;
  const rng = mulberry32(seed);

  const sequence = shuffle(set.prompts, rng).map((p) => ({ p, repeat: false }));
  for (const category of CATEGORIES) {
    const pool = set.prompts.filter((p) => p.category === category);
    if (pool.length < repeats[category]) throw new Error(`${repeats[category]} ${category} repeats asked for, but only ${pool.length} ${category} prompts exist`);
    for (const p of shuffle(pool, rng).slice(0, repeats[category])) {
      const first = sequence.findIndex((s) => s.p.id === p.id);
      const at = first + 1 + Math.floor(rng() * (sequence.length - first));
      sequence.splice(at, 0, { p, repeat: true });
    }
  }

  let items: WorkloadItem[] = sequence.map((s, index) => ({ index, id: s.p.id, category: s.p.category, text: s.p.text, repeat: s.repeat }));
  if (options.limit !== undefined) items = items.slice(0, Math.max(0, options.limit));

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { requests: items.filter((i) => i.category === c).length, repeats: items.filter((i) => i.category === c && i.repeat).length }]),
  ) as Composition["by_category"];
  const repeatCount = items.filter((i) => i.repeat).length;
  const hash = createHash("sha256")
    .update(JSON.stringify({ system_prompt: set.system_prompt, items: items.map((i) => [i.id, i.text]) }))
    .digest("hex");

  return {
    seed,
    system_prompt: set.system_prompt,
    items,
    composition: {
      requests: items.length,
      unique_prompts: new Set(items.map((i) => i.id)).size,
      repeats: repeatCount,
      repeat_share: items.length ? Math.round((repeatCount / items.length) * 1000) / 1000 : 0,
      by_category: byCategory,
    },
    hash: `sha256:${hash}`,
  };
}

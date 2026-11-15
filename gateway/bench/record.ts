// Records one answer per benchmark prompt from a model, with a hard spend limit.
//
// Cost control: it only records prompts it hasn't recorded yet (so a stopped run resumes), measures real cost from the
// token counts the provider reports, and stops before the total passes `maxUsd`, saving what it has. A run that fails
// its first requests stops straight away instead of paying for the rest.

import { type RecordedAnswer, type Recordings, recordKey } from "./recordings.ts";
import { DEFAULT_RETRY_DELAYS_MS, LIST_PRICES, post } from "./run.ts";
import type { BenchPrompt, PromptSet } from "./workload.ts";

const FAIL_FAST_AFTER = 3;

export const priceOf = (model: string, tokensIn: number, tokensOut: number): number | null => {
  const p = LIST_PRICES[model];
  return p ? (tokensIn * p.input + tokensOut * p.output) / 1e6 : null;
};

/** The most recording these prompts could cost: every answer at max_tokens, inputs approximated as characters / 4. */
export function worstCaseUSD(prompts: BenchPrompt[], systemPrompt: string, model: string, maxTokens: number): number | null {
  let total = 0;
  for (const p of prompts) {
    const c = priceOf(model, Math.ceil((systemPrompt.length + p.text.length) / 4) + 20, maxTokens);
    if (c === null) return null;
    total += c;
  }
  return total;
}

export interface RecordOptions {
  bifrostUrl: string;
  bifrostVirtualKey?: string;
  model: string;
  maxTokens: number;
  concurrency: number;
  /** Stop before the measured cost passes this many US dollars. */
  maxUsd: number;
  set: PromptSet;
  /** Answers recorded earlier; prompts already in here are skipped. */
  existing?: Recordings | null;
  retryDelaysMs?: number[];
  onProgress?: (done: number, total: number, spentUsd: number) => void;
}

export interface RecordResult {
  recordings: Recordings;
  /** Answers recorded by this run. */
  recorded: number;
  /** Prompts skipped because they were already recorded. */
  skipped: number;
  spentUsd: number;
  /** Why it stopped early, if it did. */
  stopped?: string;
}

export async function recordAnswers(options: RecordOptions): Promise<RecordResult> {
  const { set, model, maxTokens } = options;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const keep = options.existing && options.existing.model === model && options.existing.max_tokens === maxTokens ? options.existing : null;
  const answers: Record<string, RecordedAnswer> = { ...(keep?.answers ?? {}) };
  const before = Object.keys(answers).length;
  const todo = set.prompts.filter((p) => !answers[recordKey(set.system_prompt, p.text)]);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.bifrostVirtualKey ? { "x-bf-vk": options.bifrostVirtualKey } : {}) };

  let spent = keep?.cost_usd ?? 0;
  const earlier = spent;
  let next = 0;
  let done = 0;
  let failed = 0;
  let stopped: string | undefined;

  const worker = async () => {
    while (next < todo.length && !stopped) {
      const p = todo[next++];
      // Don't start a request that could take the total past the limit.
      const worst = priceOf(model, Math.ceil((set.system_prompt.length + p.text.length) / 4) + 20, maxTokens);
      if (worst !== null && spent + worst > options.maxUsd) {
        stopped = `The next answer could cost up to $${worst.toFixed(4)}, which would pass the $${options.maxUsd.toFixed(2)} limit (spent so far $${spent.toFixed(4)}).`;
        return;
      }
      const body = JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: set.system_prompt }, { role: "user", content: p.text }] });
      const posted = await post(`${options.bifrostUrl}/v1/chat/completions`, headers, body, delays);
      done++;
      let data: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string | null }; finish_reason?: string }[] } | null = null;
      try {
        data = posted.res?.ok ? JSON.parse(posted.text) : null;
      } catch {
        data = null;
      }
      const usage = data?.usage;
      const finish = data?.choices?.[0]?.finish_reason;
      // These models always think first. A prompt can use up max_tokens before any text comes out: the provider
      // sends no content, still bills the tokens, and a real run would see exactly that, so it is recorded as a
      // cut-off answer with empty text, not as a failure.
      const raw = data?.choices?.[0]?.message?.content;
      const content = typeof raw === "string" ? raw : raw == null && finish === "length" ? "" : undefined;
      if (!data || content === undefined || usage?.prompt_tokens === undefined || usage.completion_tokens === undefined) {
        failed++;
        if (done === FAIL_FAST_AFTER && failed === done) stopped = `The first ${FAIL_FAST_AFTER} requests all failed. Last: ${posted.error ?? `HTTP ${posted.status} ${posted.text.slice(0, 160)}`}`;
        options.onProgress?.(done, todo.length, spent);
        continue;
      }
      spent += priceOf(model, usage.prompt_tokens, usage.completion_tokens) ?? 0;
      answers[recordKey(set.system_prompt, p.text)] = {
        id: p.id,
        content,
        tokens_in: usage.prompt_tokens,
        tokens_out: usage.completion_tokens,
        finish_reason: data.choices?.[0]?.finish_reason ?? "stop",
        latency_ms: Math.round(posted.latencyMs),
      };
      options.onProgress?.(done, todo.length, spent);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, todo.length || 1)) }, worker));

  return {
    recordings: { recorded_at: new Date().toISOString(), model, max_tokens: maxTokens, cost_usd: Math.round(spent * 10000) / 10000, answers },
    recorded: Object.keys(answers).length - before,
    skipped: set.prompts.length - todo.length,
    spentUsd: spent - earlier,
    stopped,
  };
}

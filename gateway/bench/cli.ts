// npm run bench -- [--yes] [--limit N] [--concurrency N] [--max-tokens N] [--seed N] [--model M] [--print-workload]
//
// Without --yes it only prints the plan: the workload, what the classifier would do with it, and the
// worst-case cost. Nothing is sent to any model until you add --yes, because a run spends API credit.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import type { Range } from "../src/types.ts";
import { type BenchPlan, type BenchReport, planBenchmark, runBenchmark, saveReport } from "./run.ts";
import { buildWorkload, CATEGORIES, DEFAULT_SEED, loadPromptSet } from "./workload.ts";

const { values: args } = parseArgs({
  options: {
    yes: { type: "boolean", default: false },
    limit: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "max-tokens": { type: "string", default: "2048" },
    seed: { type: "string", default: String(DEFAULT_SEED) },
    "max-usd": { type: "string", default: "0.40" },
    model: { type: "string" },
    "print-workload": { type: "boolean", default: false },
  },
});

const int = (name: string, v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive whole number`);
  return n;
};

const config = loadConfig();
const gatewayUrl = (process.env.GATEWAY_URL || `http://localhost:${config.port}`).replace(/\/+$/, "");
const workload = buildWorkload(await loadPromptSet(), { seed: int("seed", args.seed), limit: args.limit ? int("limit", args.limit) : undefined });

if (args["print-workload"]) {
  for (const i of workload.items) console.log(`${String(i.index + 1).padStart(3)}  ${i.id}  ${i.category.padEnd(14)} ${i.repeat ? "repeat" : "      "}  ${i.text.replace(/\s+/g, " ").slice(0, 90)}`);
  process.exit(0);
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const ml = (r: Range) => `${r.low.toFixed(1)}–${r.high.toFixed(1)} mL`;
const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-US");

let health: { intelligence: boolean; routing: boolean; cache: boolean; large_model: string; small_model: string };
try {
  health = await (await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) })).json();
} catch {
  console.error(`The gateway isn't answering at ${gatewayUrl}. Start it first: npm run serve (and the intelligence API on ${config.intelligenceUrl}).`);
  process.exit(1);
}
if (!health.intelligence) {
  console.error(`The gateway can't reach the intelligence API at ${config.intelligenceUrl}. Start it first: cd ../intelligence && npm run serve.`);
  process.exit(1);
}

const model = args.model ?? health.large_model;
const routes = health.routing && model === health.large_model;
if (model !== health.large_model) console.warn(`Note: the gateway only re-routes requests for ${health.large_model}; ${model} will never be routed.`);
if (!health.routing) console.warn("Note: routing is off in the gateway (ROUTING=off), so this run measures caching and budgets only.");
if (!health.cache) console.warn("Note: the cache is off in the gateway (CACHE=off).");

const maxTokens = int("max-tokens", args["max-tokens"]);
const concurrency = int("concurrency", args.concurrency);
const plan: BenchPlan = await planBenchmark({ intelligenceUrl: config.intelligenceUrl, workload, model, maxTokens, routes, cache: health.cache });

const c = plan.workload;
console.log(`\nWorkload  ${c.requests} requests: ${c.unique_prompts} unique prompts, ${c.repeats} sent twice (${pct(c.repeat_share)}), seed ${c.seed}`);
console.log(`          ${CATEGORIES.map((k) => `${k} ${c.by_category[k].requests}`).join(", ")}   ${c.hash.slice(0, 19)}…`);
console.log(`Model     ${model}, max_tokens ${maxTokens}, ${concurrency} in flight; small model ${health.small_model}`);
console.log(`\nPlan (the classifier's decisions; no model was called):`);
console.log(`  model calls     ${plan.predicted.model_calls_without_dropwise} without Dropwise, ${plan.predicted.model_calls_with_dropwise} with (${plan.predicted.cache_hits} cache hits)`);
console.log(`  routed small    ${plan.predicted.routed_small} of ${plan.predicted.model_calls_with_dropwise} calls (${pct(plan.predicted.routed_small_share)})`);
console.log(`  cache bypassed  ${plan.predicted.cache_bypassed} time-sensitive requests`);
for (const k of CATEGORIES) {
  const b = plan.predicted.by_category[k];
  console.log(`    ${k.padEnd(15)} ${String(b.requests).padStart(3)} requests  ${String(b.routed_small).padStart(3)} routed small  ${String(b.cache_hits).padStart(3)} cache hits  ${String(b.cache_bypassed).padStart(3)} bypassed`);
}
console.log(`  worst-case cost ${usd(plan.worst_case_cost_usd)} for both runs (every answer at max_tokens, nothing routed or cached)`);

// Bifrost can be a replay server (npm run bench:replay): recorded answers, no model, no cost.
const replaying = await fetch(`${config.bifrostUrl}/replay`, { signal: AbortSignal.timeout(3000) })
  .then(async (r) => r.ok && (await r.json()).replay === true)
  .catch(() => false);
const maxUsd = Number(args["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be a positive number");

if (replaying) {
  console.log(`\nBifrost at ${config.bifrostUrl} is a replay server: answers come from a recording, so this run makes no model calls and costs nothing.`);
} else {
  // A live run spends real credit: refuse one that could cost more than the limit, before sending anything.
  if (plan.worst_case_cost_usd === null || plan.worst_case_cost_usd > maxUsd) {
    console.log(
      `\nRefusing to run: the worst case is ${usd(plan.worst_case_cost_usd)}, over the --max-usd limit of $${maxUsd.toFixed(2)}. ` +
        "Use the recorded-answer route instead (npm run bench:record, then npm run bench:replay), or lower --max-tokens or --limit, or raise --max-usd.",
    );
    process.exit(args.yes ? 1 : 0);
  }
  if (!args.yes) {
    console.log(`\nNo requests were sent. A run makes up to ${plan.predicted.model_calls_without_dropwise + plan.predicted.model_calls_with_dropwise} model calls through Bifrost at ${config.bifrostUrl}.`);
    console.log(`Add --yes to run it (it spends API credit, and stops at an estimated $${maxUsd.toFixed(2)}). Try --limit 10 --yes first to check the setup.`);
    process.exit(0);
  }
}

let lastLine = "";
const report: BenchReport = await runBenchmark({
  bifrostUrl: config.bifrostUrl,
  gatewayUrl,
  intelligenceUrl: config.intelligenceUrl,
  workload,
  model,
  maxTokens,
  concurrency,
  bifrostVirtualKey: process.env.BIFROST_VIRTUAL_KEY || undefined,
  maxUsd,
  onProgress: (side, done, total) => {
    const line = `${side === "without_dropwise" ? "Without Dropwise" : "With Dropwise   "} ${done}/${total}`;
    if (done % 10 === 0 || done === total) {
      if (line !== lastLine) process.stderr.write(line + "\n");
      lastLine = line;
    }
  },
});
const file = await saveReport(report, join(config.dataDir, "benchmark"));

const a = report.runs.without_dropwise;
const b = report.runs.with_dropwise;
const row = (label: string, without: string, withD: string) => console.log(`  ${label.padEnd(34)} ${without.padStart(18)} ${withD.padStart(18)}`);
console.log(`\nResults${report.clean ? "" : "  (NOT CLEAN: some requests failed; see errors)"}`);
row("", "Without Dropwise", "With Dropwise");
row("Model calls (measured)", num(a.model_calls), num(b.model_calls));
row("Cache hits (measured)", "0", `${b.cache_hits} (${pct(report.measured.cache_hit_share)})`);
row("Cache bypassed, time-sensitive", "–", String(b.cache_bypassed));
row("Routed to the small model", "–", `${b.routed_small} (${pct(b.routed_small_share)})`);
row("Tokens in + out (measured)", num(a.tokens_total), num(b.tokens_total));
row("Latency p50 / p95, ms (measured)", `${num(a.latency_ms.p50)} / ${num(a.latency_ms.p95)}`, `${num(b.latency_ms.p50)} / ${num(b.latency_ms.p95)}`);
row("Dropwise overhead p50 / p95, ms", "–", `${b.gateway_overhead_ms.p50} / ${b.gateway_overhead_ms.p95}`);
row("Water, direct + indirect (est.)", ml(report.estimated.water_ml.direct_plus_indirect.without_dropwise), ml(report.estimated.water_ml.direct_plus_indirect.with_dropwise));
row("Water, direct only (est.)", ml(report.estimated.water_ml.direct_only.without_dropwise), ml(report.estimated.water_ml.direct_only.with_dropwise));
row("Cost at list prices (est.)", usd(report.estimated.cost_usd.without_dropwise), usd(report.estimated.cost_usd.with_dropwise));
row("Errors / retries / truncated", `${a.errors} / ${a.retries} / ${a.truncated}`, `${b.errors} / ${b.retries} / ${b.truncated}`);
for (const e of [...a.error_samples, ...b.error_samples]) console.log(`  error: ${e}`);
console.log(`\nSaved ${file} (also latest.json, served at ${gatewayUrl}/benchmark/latest)`);

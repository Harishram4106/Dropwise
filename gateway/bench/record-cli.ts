// npm run bench:record -- [--yes] [--max-usd 0.40] [--max-tokens 1024] [--model M] [--concurrency N] [--limit N]
//
// Sends each of the benchmark's 150 unique prompts to ONE model, once, and saves the answers to bench/recordings.json.
// `npm run bench:replay` then serves them in place of Bifrost, so the benchmark can be run and re-run for free.
//
// Without --yes it only prints what it would do and the most it could cost. With --yes it spends API credit, and it
// stops before the measured cost passes --max-usd (default $0.40), saving what it has; run it again to resume.

import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import { recordAnswers, worstCaseUSD } from "./record.ts";
import { loadRecordings, RECORDINGS_FILE, saveRecordings } from "./recordings.ts";
import { loadPromptSet } from "./workload.ts";

const { values: args } = parseArgs({
  options: {
    yes: { type: "boolean", default: false },
    "max-usd": { type: "string", default: "0.40" },
    "max-tokens": { type: "string", default: "1024" },
    model: { type: "string", default: "anthropic/claude-haiku-5-5" },
    concurrency: { type: "string", default: "3" },
    limit: { type: "string" },
    file: { type: "string", default: RECORDINGS_FILE },
  },
});

const positive = (name: string, v: string | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};

const config = loadConfig();
const set = await loadPromptSet();
if (args.limit) set.prompts = set.prompts.slice(0, Math.floor(positive("limit", args.limit)));
const model = args.model!;
const maxTokens = Math.floor(positive("max-tokens", args["max-tokens"]));
const maxUsd = positive("max-usd", args["max-usd"]);
const existing = await loadRecordings(args.file);
const resumable = existing && existing.model === model && existing.max_tokens === maxTokens ? Object.keys(existing.answers).length : 0;

const worst = worstCaseUSD(set.prompts, set.system_prompt, model, maxTokens);
console.log(`\nRecording  ${set.prompts.length} unique prompts to ${args.file}`);
console.log(`Model      ${model}, max_tokens ${maxTokens}${resumable ? `, ${resumable} already recorded (they are skipped)` : ""}`);
console.log(`Through    Bifrost at ${config.bifrostUrl}`);
console.log(`Cost       at most ${worst === null ? "unknown (no list price for this model)" : `$${worst.toFixed(4)}`} if every answer hit max_tokens; limit $${maxUsd.toFixed(2)}`);

if (worst === null) {
  console.error(`\nNo list price for ${model}, so the cost can't be guarded. Add it to LIST_PRICES in bench/run.ts first.`);
  process.exit(1);
}
if (worst > maxUsd && resumable === 0) {
  console.log(`\nThe worst case is over the limit; the run would still stop at $${maxUsd.toFixed(2)} and save what it has. Lower --max-tokens or --limit for a full set.`);
}
if (!args.yes) {
  console.log("\nNo requests were sent. Add --yes to record (it spends API credit, up to the limit above).");
  process.exit(0);
}

let last = 0;
const result = await recordAnswers({
  bifrostUrl: config.bifrostUrl,
  bifrostVirtualKey: process.env.BIFROST_VIRTUAL_KEY || undefined,
  model,
  maxTokens,
  concurrency: Math.floor(positive("concurrency", args.concurrency)),
  maxUsd,
  set,
  existing,
  onProgress: (done, total, spent) => {
    if (done - last >= 10 || done === total) {
      last = done;
      process.stderr.write(`${done}/${total}  $${spent.toFixed(4)} spent\n`);
    }
  },
});
await saveRecordings(result.recordings, args.file);

console.log(`\nRecorded ${result.recorded} answers (${Object.keys(result.recordings.answers).length} of ${set.prompts.length} prompts now covered), cost $${result.spentUsd.toFixed(4)}.`);
if (result.stopped) {
  console.log(`Stopped early: ${result.stopped}`);
  console.log("Saved what was recorded. Run the same command again to resume.");
  process.exit(2);
}
console.log(`Saved ${args.file}. Next: npm run bench:replay, then point BIFROST_URL at it and run npm run bench.`);

import { chat } from "../bifrost.ts";
import { DEFAULT_MAX_DROP_PTS, evaluateQuality, evaluateRouting, loadEvalSet, saveQualityReport, type RoutingMistake } from "./eval.ts";

const [command = "routing", ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const list = (title: string, rows: RoutingMistake[]) => {
  console.log(`${title}: ${rows.length}`);
  for (const r of rows) console.log(`  - ${r.id} [${r.signals.join(", ") || "no signals"}] ${r.prompt.replace(/\n/g, " ")}`);
};

const set = await loadEvalSet();

if (command === "routing") {
  const r = evaluateRouting(set);
  console.log(`Routing eval: ${r.items} prompts, offline, classifier only\n`);
  console.log(`Tier accuracy        ${pct(r.tier_accuracy)}`);
  console.log(`Routed to small      ${pct(r.routed_small_share)}`);
  console.log(`Time-sensitivity     precision ${pct(r.time_sensitivity.precision)}, recall ${pct(r.time_sensitivity.recall)}`);
  console.log(`Classifier latency   ${r.avg_classify_us} µs per request\n`);
  list("Hard prompts sent small (quality risk)", r.hard_routed_small);
  list("Easy prompts kept large (lost savings only)", r.easy_kept_large);
  list("Wrongly flagged time-sensitive (cache bypassed needlessly)", r.time_sensitivity.false_positives);
  list("Missed time-sensitive (stale cache risk)", r.time_sensitivity.missed);
  if (r.hard_routed_small.length || r.time_sensitivity.missed.length) process.exitCode = 1;
} else if (command === "quality") {
  const small = flag("--small") ?? process.env.SMALL_MODEL;
  const large = flag("--large") ?? process.env.LARGE_MODEL;
  if (!small || !large) {
    console.error("Set SMALL_MODEL and LARGE_MODEL in .env (or pass --small and --large), and start Bifrost.");
    process.exit(1);
  }
  const maxDropPts = Number(flag("--max-drop") ?? DEFAULT_MAX_DROP_PTS);
  console.log(`Answering ${set.items.filter((i) => i.check.type !== "none").length} prompts with ${small} and ${large} through Bifrost...`);
  const report = await evaluateQuality(set, {
    small,
    large,
    maxDropPts,
    answer: (model, system, prompt) =>
      chat(
        [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        model,
      ),
  });
  const file = await saveQualityReport(report);
  console.log(`\nPass rate, all large   ${pct(report.pass_rate.all_large)}`);
  console.log(`Pass rate, routed      ${pct(report.pass_rate.routed)}   (${pct(report.routed_small_share)} sent small)`);
  console.log(`Pass rate, all small   ${pct(report.pass_rate.all_small)}`);
  console.log(`Quality drop           ${report.quality_drop_pts} points (limit ${report.max_drop_pts}) -> ${report.guard.toUpperCase()}`);
  if (report.lost.length) console.log(`Lost by routing        ${report.lost.join(", ")}`);
  console.log(`\n${report.recommendation}\nSaved ${file}`);
  if (report.guard === "fail") process.exitCode = 1;
} else {
  console.error("Usage: npm run eval -- routing | quality [--small <model>] [--large <model>] [--max-drop 5]");
  process.exit(1);
}

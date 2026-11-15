import { classify } from "./classify.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const prompt = args.filter((a) => !a.startsWith("--")).join(" ");

if (!prompt) {
  console.error('Usage: npm run route -- "What is the capital of Australia?" [--json]');
  process.exit(1);
}

const d = classify({ prompt });
if (json) {
  console.log(JSON.stringify(d, null, 2));
} else {
  console.log(`Tier: ${d.tier} (confidence ${d.confidence})   cache: ${d.cache}`);
  for (const r of d.reasons) console.log(`  - ${r}`);
}

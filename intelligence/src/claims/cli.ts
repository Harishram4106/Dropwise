import { checkClaim } from "./check.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const offline = args.includes("--offline");
const claim = args.filter((a) => !a.startsWith("--")).join(" ");

if (!claim) {
  console.error('Usage: npm run claim -- "one ChatGPT query uses a bottle of water" [--json] [--offline]');
  process.exit(1);
}

try {
  const { result, warnings } = await checkClaim(claim, offline ? { useModel: false, useLive: false } : {});
  for (const w of warnings) console.error(`warning: ${w}`);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Claim: ${result.claim}`);
    console.log(`Split by ${result.decomposition}; evidence: ${result.evidence}; registry ${result.registry_hash ?? "(unpublished working copy)"}\n`);
    for (const a of result.atomic_claims) {
      console.log(`[${a.verdict.toUpperCase()}] ${a.text}`);
      console.log(`  counts: ${a.counts}   freshness: ${a.freshness_score.toFixed(2)}`);
      console.log(`  ${a.explanation}`);
      for (const s of a.sources) console.log(`  - ${s}`);
      console.log();
    }
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

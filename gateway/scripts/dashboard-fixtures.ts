// Builds the dashboard's demo-mode fixtures from the real gateway + real classifier + signed registry,
// with a fake model standing in for Bifrost (no API calls, no cost). Usage figures are synthetic.
// node gateway/scripts/dashboard-fixtures.ts <frontend>/src/fixtures

import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { createApiServer } = await import(`${repo}/intelligence/src/server.ts`);
const { loadConfig } = await import(`${repo}/gateway/src/config.ts`);
const { createDeps, createGatewayServer } = await import(`${repo}/gateway/src/server.ts`);
const prompts = (await import(`${repo}/gateway/bench/prompts.json`, { with: { type: "json" } })).default as {
  system_prompt: string;
  prompts: { id: string; category: string; text: string }[];
};

const out = process.argv[2];
if (!out) throw new Error("usage: make-fixtures.ts <out-dir>");

// Deterministic pseudo-random numbers, so the fixtures are the same on every build.
let seed = 11;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

const fake = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const text = body.messages.map((m: { content: string }) => m.content).join(" ");
  const small = String(body.model).includes("haiku");
  const tokensIn = Math.ceil(text.length / 4) + 8;
  const tokensOut = Math.round(small ? 90 + rand() * 260 : 320 + rand() * 900);
  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut } }));
  }, 5);
});

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, r));
const port = (s: Server) => (s.address() as AddressInfo).port;

const intelligence: Server = createApiServer();
await Promise.all([listen(fake), listen(intelligence)]);
const dataDir = await mkdtemp(join(tmpdir(), "dropwise-fixtures-"));
await copyFile(`${repo}/gateway/data/budgets.json`, join(dataDir, "budgets.json"));
await copyFile(`${repo}/gateway/data/hourly-profile.json`, join(dataDir, "hourly-profile.json"));
const config = loadConfig({
  DATA_DIR: dataDir,
  BIFROST_URL: `http://localhost:${port(fake)}`,
  INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`,
  SMALL_MODEL: "anthropic/claude-haiku-5-5",
  LARGE_MODEL: "anthropic/claude-opus-5-5",
  PROMPT_PREVIEW_CHARS: "80",
});
const deps = await createDeps(config);
const gateway: Server = createGatewayServer(deps);
await listen(gateway);
const gw = `http://localhost:${port(gateway)}`;

// A mixed, believable sequence: easy, hard and time-sensitive prompts across three teams, with repeats.
const by = (cat: string) => prompts.prompts.filter((p) => p.category === cat);
const pick = <T,>(xs: T[], n: number) => xs.filter((_, i) => i % Math.floor(xs.length / n) === 0).slice(0, n);
const base = [...pick(by("easy"), 20), ...pick(by("hard"), 14), ...pick(by("time_sensitive"), 6)];
const order = base.map((p) => ({ p, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.p);
const seq: typeof base = [];
for (const [i, p] of order.entries()) {
  seq.push(p);
  // Every fourth prompt comes back a little later, as repeated questions do.
  if (i % 4 === 1) order.splice(Math.min(order.length, i + 3 + Math.floor(rand() * 5)), 0, { ...p });
}
const keys = ["team-search", "team-support", "team-research"];
// A prompt always comes from the same team (the cache is per key, so repeats can hit), spread across the three.
const owner = new Map<string, number>();
const keyOf = (id: string) => {
  if (!owner.has(id)) owner.set(id, owner.size % keys.length);
  return owner.get(id)!;
};

for (const [i, p] of seq.slice(0, 60).entries()) {
  const res = await fetch(`${gw}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dropwise-key": keys[keyOf(p.id)] },
    body: JSON.stringify({ model: "anthropic/claude-opus-5-5", messages: [{ role: "system", content: prompts.system_prompt }, { role: "user", content: p.text }] }),
  });
  if (!res.ok) throw new Error(`${p.id}: ${res.status} ${await res.text()}`);
  await res.text();
}

// Time shifting: deferred requests queued against the shipped, illustrative hourly profile at a fixed moment
// (18:30 UTC, mid-day in the profile's time zone) so the saved demo has jobs that run now and jobs that wait for the
// evening or the night. The first one is run, so it has a receipt; the rest stay scheduled.
const { runJob } = await import(`${repo}/gateway/src/scheduler.ts`);
const snapshot = new Date(`${new Date().toISOString().slice(0, 10)}T18:30:00Z`);
const deferred = [
  { id: "e05", key: "team-research", hours: 3 },
  { id: "e13", key: "team-support", hours: 12 },
  { id: "h07", key: "team-research", hours: 8 },
  { id: "e22", key: "team-search", hours: 24 },
  { id: "h19", key: "team-support", hours: 30 },
];
let firstJob = "";
for (const [i, d] of deferred.entries()) {
  const p = prompts.prompts.find((x) => x.id === d.id) ?? prompts.prompts[i];
  const job = await deps.jobs.create({
    virtualKey: d.key,
    model: "anthropic/claude-opus-5-5",
    preview: p.text.slice(0, 80),
    body: { model: "anthropic/claude-opus-5-5", messages: [{ role: "system", content: prompts.system_prompt }, { role: "user", content: p.text }] },
    headers: { "x-dropwise-key": d.key },
    deadline: new Date(snapshot.getTime() + d.hours * 3600_000),
    now: snapshot,
  });
  if (i === 0) firstJob = job.id;
}
await runJob(deps, firstJob);
// The run happened a moment after the snapshot, as it would have in real time.
const ranAt = new Date(snapshot.getTime() + 4000).toISOString();
await deps.jobs.update(firstJob, { deferred: { ...deps.jobs.raw(firstJob)!.deferred, ran_at: ranAt } });
const jobsNow = deps.jobs.list();
const hourly = { profile: deps.jobs.profile };

const receipts = (await (await fetch(`${gw}/receipts?limit=500`)).json()).reverse();
// The deferred receipt's run time is the snapshot's, not the moment this script ran.
for (const r of receipts) if (r.deferred) r.deferred = { ...r.deferred, ran_at: ranAt };
const health = await (await fetch(`${gw}/health`)).json();
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "jobs.json"),
  JSON.stringify(
    {
      note: "Demo-mode fixture: deferred requests queued through the real gateway against the shipped, illustrative hourly profile (stand-in model). Times are rebased to now when shown.",
      saved_at: snapshot.toISOString(),
      profile: hourly.profile,
      // The fake model's answer text is meaningless, so saved jobs keep their status and receipt but not the result.
      jobs: jobsNow.map((j: Record<string, unknown>) => ({ ...j, result: undefined })),
    },
    null,
    1,
  ) + "\n",
);
await writeFile(
  join(out, "receipts.json"),
  JSON.stringify(
    {
      note: "Demo-mode fixture: real Dropwise gateway, real classifier and signed registry; the model was a stand-in, so token counts are synthetic.",
      health: { small_model: health.small_model, large_model: health.large_model, routing: health.routing, cache: health.cache, scope: health.scope },
      receipts,
    },
    null,
    1,
  ) + "\n",
);
// The before / after benchmark. If a real run exists (gateway/data/benchmark/latest.json, from npm run bench), the
// dashboard's saved copy IS that run. Only when none exists is one made here, through the real gateway and
// classifier with the stand-in model: cache hits, routing and bypasses are real, token counts and latency are not,
// and the dashboard says so.
import { stat } from "node:fs/promises";
const realRun = join(repo, "gateway", "data", "benchmark", "latest.json");
if (await stat(realRun).then(() => true, () => false)) {
  await copyFile(realRun, join(out, "benchmark.json"));
  console.log("benchmark: copied the real run from gateway/data/benchmark/latest.json");
} else {
  const { runBenchmark } = await import(`${repo}/gateway/bench/run.ts`);
  const { buildWorkload, loadPromptSet } = await import(`${repo}/gateway/bench/workload.ts`);
  const benchmark = await runBenchmark({
    bifrostUrl: config.bifrostUrl,
    gatewayUrl: gw,
    intelligenceUrl: config.intelligenceUrl,
    workload: buildWorkload(await loadPromptSet()),
    model: "anthropic/claude-opus-5-5",
    maxTokens: 2048,
    concurrency: 4,
    runId: "demo",
    retryDelaysMs: [1, 1, 1],
  });
  await writeFile(join(out, "benchmark.json"), JSON.stringify(benchmark, null, 1) + "\n");
  console.log(`benchmark: stand-in run, clean=${benchmark.clean}, ${benchmark.runs.with_dropwise.model_calls} calls with Dropwise of ${benchmark.runs.without_dropwise.model_calls}`);
}

// The routing page's saved answers: the classifier's decision for each sample prompt and the offline routing
// eval, both straight from the intelligence API (rules only, no model, so they are exact, not simulated).
const SAMPLE_PROMPTS = [
  "What's the weather in Chennai right now?",
  "Fix the typo in this sentence: 'Their going to the market tomorow.'",
  "Is 2^31 - 1 prime?",
  "Convert 72 degrees Fahrenheit to Celsius.",
  "Write a Python function that merges two sorted lists.",
  "What are the latest tech news headlines today?",
  "Is it safe to take ibuprofen together with a blood thinner?",
  "What is the capital of Canada?",
];
const samples = [];
for (const prompt of SAMPLE_PROMPTS) {
  const decision = await (await fetch(`${config.intelligenceUrl}/route/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) })).json();
  samples.push({ prompt, decision });
}
const routingEval = await (await fetch(`${config.intelligenceUrl}/eval/routing`)).json();
await writeFile(
  join(out, "routing.json"),
  JSON.stringify({ note: "Demo-mode fixture: POST /route/classify for each sample prompt and GET /eval/routing from the intelligence API.", samples, eval: routingEval }, null, 1) + "\n",
);
console.log(`routing: ${samples.length} samples, eval ${routingEval.items} items`, samples.map((x) => `${x.decision.tier}${x.decision.cache === "bypass" ? "/bypass" : ""}`).join(" "));

// The claims page's saved answers: POST /claims/check for each sample claim (split by rules, checked against the
// signed registry: no model, no live search, so they are exact, not simulated).
const SAMPLE_CLAIMS = [
  "One ChatGPT question equals a bottle of water.",
  "AI doesn't use any water at all.",
  "Google says a median Gemini prompt uses about 0.26 mL.",
  "Every AI company measures water the same way.",
  "ChatGPT uses 500 mL of water per answer, while a Gemini prompt uses 0.26 mL.",
  "A typical ChatGPT query uses about 0.32 mL of water.",
];
const claims = [];
for (const claim of SAMPLE_CLAIMS) {
  const result = await (await fetch(`${config.intelligenceUrl}/claims/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim }) })).json();
  claims.push({ claim, result });
}
await writeFile(join(out, "claims.json"), JSON.stringify({ note: "Demo-mode fixture: POST /claims/check for each sample claim from the intelligence API (rules split, signed registry only).", claims }, null, 1) + "\n");
console.log(`claims: ${claims.length}`, claims.map((c) => c.result.atomic_claims.map((a) => a.verdict).join("+")).join(" | "));

// The stale-factor demo (GET /demo/stale-factor): its captured result, offline.
const stale = await (await fetch(`${config.intelligenceUrl}/demo/stale-factor`)).json();
await writeFile(join(out, "stale-factor.json"), JSON.stringify(stale, null, 1) + "\n");

// The registry as the intelligence API serves it, for the citation drawer in demo mode.
const registry = await (await fetch(`${config.intelligenceUrl}/registry`)).json();
await writeFile(
  join(out, "registry.json"),
  JSON.stringify({ note: "Demo-mode fixture: GET /registry from the intelligence API (the signed Evidence Registry).", ...registry }, null, 1) + "\n",
);
console.log(`${registry.entries.length} registry entries, version ${registry.version}`);
console.log(`${receipts.length} receipts`, {
  hits: receipts.filter((r: { cache: string }) => r.cache === "hit").length,
  bypass: receipts.filter((r: { cache: string }) => r.cache === "bypass").length,
  small: receipts.filter((r: { routed_to: string; model: string }) => r.routed_to !== r.model).length,
});
for (const s of [gateway, intelligence, fake]) s.close();

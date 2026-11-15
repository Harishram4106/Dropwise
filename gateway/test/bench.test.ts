// Benchmark harness tests: the real classifier and registry, the real gateway, and a fake Bifrost.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../intelligence/src/server.ts";
import { costUSD, planBenchmark, runBenchmark, saveReport } from "../bench/run.ts";
import { buildWorkload, loadPromptSet, type Workload } from "../bench/workload.ts";
import { loadConfig } from "../src/config.ts";
import { createDeps, createGatewayServer } from "../src/server.ts";

const LARGE = "anthropic/claude-opus-5-5";
const SMALL = "anthropic/claude-haiku-5-5";

const fake = { server: createServer(), calls: 0, failNext: 0 };
let intelligence: Server;
let gateway: Server;
let urls: { bifrost: string; gateway: string; intelligence: string };
let dataDir = "";
let workload: Workload;

const port = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, r));
const retryDelaysMs = [1, 1, 1];

before(async () => {
  fake.server.on("request", async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    fake.calls++;
    if (fake.failNext > 0) {
      fake.failNext--;
      res.writeHead(529, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "overloaded" } }));
    }
    // The small model writes shorter answers, as real ones tend to.
    const out = String(body.model).includes("haiku") ? 80 : 200;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: out } }));
  });
  intelligence = createApiServer();
  await Promise.all([listen(fake.server), listen(intelligence)]);

  dataDir = await mkdtemp(join(tmpdir(), "dropwise-bench-"));
  await writeFile(join(dataDir, "budgets.json"), JSON.stringify({ period: "day", keys: { "*": { limit_ml: 100000 } } }));
  const config = loadConfig({
    DATA_DIR: dataDir,
    BIFROST_URL: `http://localhost:${port(fake.server)}`,
    INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`,
    SMALL_MODEL: SMALL,
    LARGE_MODEL: LARGE,
  });
  gateway = createGatewayServer(await createDeps(config));
  await listen(gateway);
  urls = { bifrost: config.bifrostUrl, gateway: `http://localhost:${port(gateway)}`, intelligence: config.intelligenceUrl };
  workload = buildWorkload(await loadPromptSet());
});

after(() => {
  for (const s of [gateway, intelligence, fake.server]) s.close();
});

test("the workload is 200 requests from 150 prompts, the same on every build, with repeats after their originals", async () => {
  const again = buildWorkload(await loadPromptSet());
  assert.equal(workload.hash, again.hash);
  assert.deepEqual(workload.composition, {
    requests: 200,
    unique_prompts: 150,
    repeats: 50,
    repeat_share: 0.25,
    by_category: { easy: { requests: 100, repeats: 25 }, hard: { requests: 80, repeats: 20 }, time_sensitive: { requests: 20, repeats: 5 } },
  });
  const seen = new Set<string>();
  for (const item of workload.items) {
    assert.equal(seen.has(item.id), item.repeat, `${item.id} at ${item.index}`);
    seen.add(item.id);
  }
  assert.notEqual(buildWorkload(await loadPromptSet(), { seed: 8 }).hash, workload.hash);
  assert.equal(buildWorkload(await loadPromptSet(), { limit: 10 }).items.length, 10);
});

test("no benchmark prompt comes from the eval set the classifier was tuned on", async () => {
  const evalSet = JSON.parse(await readFile(new URL("../../intelligence/eval/routing-set.json", import.meta.url), "utf8")) as { items: { prompt: string }[] };
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim();
  const tuned = new Set(evalSet.items.map((i) => norm(i.prompt)));
  for (const p of (await loadPromptSet()).prompts) assert.ok(!tuned.has(norm(p.text)), `${p.id} is in the eval set`);
});

test("a full run measures both sides, and matches what the plan predicted from the classifier", async () => {
  const plan = await planBenchmark({ intelligenceUrl: urls.intelligence, workload, model: LARGE, maxTokens: 2048, routes: true, cache: true });
  const callsBefore = fake.calls;
  const report = await runBenchmark({ bifrostUrl: urls.bifrost, gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload, model: LARGE, maxTokens: 2048, concurrency: 8, runId: "t1", retryDelaysMs });

  const a = report.runs.without_dropwise;
  const b = report.runs.with_dropwise;
  assert.equal(report.clean, true);
  assert.equal(a.model_calls, 200);
  assert.deepEqual(Object.keys(a.by_model), [LARGE]);
  assert.equal(b.model_calls + b.cache_hits, 200);
  assert.equal(fake.calls - callsBefore, a.model_calls + b.model_calls, "every counted call reached Bifrost, and no others did");

  assert.equal(b.cache_hits, plan.predicted.cache_hits);
  assert.equal(b.cache_bypassed, plan.predicted.cache_bypassed);
  assert.equal(b.routed_small, plan.predicted.routed_small);
  assert.ok(b.cache_hits > 0 && b.cache_bypassed > 0 && b.routed_small > 0);
  assert.equal(report.measured.calls_avoided, b.cache_hits);
  assert.equal(b.by_model[SMALL].calls, b.routed_small);

  // Fake usage: 50 in; 200 out on the large model, 80 on the small one.
  assert.equal(a.tokens_total, 200 * 250);
  assert.equal(b.tokens_total, b.by_model[LARGE].calls * 250 + b.by_model[SMALL].calls * 130);
  // A hit saves what its original answer used: 250 tokens if the large model answered it, 130 if the small one did.
  const fromCache = report.measured.tokens_served_from_cache;
  assert.ok(fromCache >= b.cache_hits * 130 && fromCache <= b.cache_hits * 250, String(fromCache));
  assert.ok(report.measured.tokens_saved > 0);

  for (const scope of ["direct_only", "direct_plus_indirect"] as const) {
    const w = report.estimated.water_ml[scope];
    assert.ok(w.with_dropwise.high < w.without_dropwise.high, scope);
    assert.ok(w.avoided.low > 0, scope);
  }
  assert.ok(report.estimated.water_ml.direct_plus_indirect.without_dropwise.high > report.estimated.water_ml.direct_only.without_dropwise.high);
  assert.equal(report.estimated.factor_versions.length, 4);
  assert.ok(report.estimated.cost_usd.saved! > 0);
  assert.equal(report.setup.registry_hash.slice(0, 7), "sha256:");
  assert.equal(report.setup.classifier_version, "rules-1");

  const cats = report.by_category;
  assert.equal(cats.easy.requests + cats.hard.requests + cats.time_sensitive.requests, 200);
  assert.equal(cats.time_sensitive.cache_hits, 0, "time-sensitive repeats are never served from cache");
  assert.ok(b.gateway_overhead_ms.p50 > 0);
});

test("each run starts with an empty cache, so a second run on the same gateway measures the same thing", async () => {
  const opts = { bifrostUrl: urls.bifrost, gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload, model: LARGE, maxTokens: 2048, concurrency: 8, retryDelaysMs };
  const first = await runBenchmark({ ...opts, runId: "t2a" });
  const second = await runBenchmark({ ...opts, runId: "t2b" });
  assert.equal(second.runs.with_dropwise.cache_hits, first.runs.with_dropwise.cache_hits);
  assert.equal(second.runs.with_dropwise.model_calls, first.runs.with_dropwise.model_calls);
});

test("the report is saved and the gateway serves it as the latest benchmark", async () => {
  const report = await runBenchmark({ bifrostUrl: urls.bifrost, gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload: buildWorkload(await loadPromptSet(), { limit: 20 }), model: LARGE, maxTokens: 2048, concurrency: 4, runId: "t3", retryDelaysMs });
  const file = await saveReport(report, join(dataDir, "benchmark"));
  assert.match(file, /bench-t3\.json$/);
  const served = await (await fetch(`${urls.gateway}/benchmark/latest`)).json();
  assert.equal(served.run_id, "t3");
  assert.equal(served.workload.requests, 20);
});

test("reports carry exactly the fields in contracts/benchmark-report.schema.json", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/benchmark-report.schema.json", import.meta.url), "utf8"));
  const report = await runBenchmark({ bifrostUrl: urls.bifrost, gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload: buildWorkload(await loadPromptSet(), { limit: 20 }), model: LARGE, maxTokens: 2048, concurrency: 4, runId: "t6", retryDelaysMs });
  const conforms = (value: Record<string, unknown>, def: { required?: string[]; properties?: Record<string, unknown> }, where: string) => {
    for (const k of def.required ?? []) assert.ok(k in value, `${where}: missing ${k}`);
    if (def.properties) for (const k of Object.keys(value)) assert.ok(k in def.properties, `${where}: not in schema: ${k}`);
  };
  conforms(report as unknown as Record<string, unknown>, schema, "report");
  conforms(report.workload as unknown as Record<string, unknown>, schema.properties.workload, "workload");
  conforms(report.setup as unknown as Record<string, unknown>, schema.properties.setup, "setup");
  for (const side of ["without_dropwise", "with_dropwise"] as const) conforms(report.runs[side] as unknown as Record<string, unknown>, schema.$defs.side, side);
  conforms(report.measured as unknown as Record<string, unknown>, schema.properties.measured, "measured");
  conforms(report.estimated as unknown as Record<string, unknown>, schema.properties.estimated, "estimated");
  conforms(report.estimated.cost_usd as unknown as Record<string, unknown>, schema.properties.estimated.properties.cost_usd, "cost_usd");
  for (const c of ["easy", "hard", "time_sensitive"] as const) conforms(report.by_category[c] as unknown as Record<string, unknown>, schema.$defs.category, c);
  assert.match(report.workload.hash, new RegExp(schema.properties.workload.properties.hash.pattern));
});

test("overloaded responses are retried and counted", async () => {
  fake.failNext = 2;
  const report = await runBenchmark({ bifrostUrl: urls.bifrost, gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload: buildWorkload(await loadPromptSet(), { limit: 5 }), model: LARGE, maxTokens: 2048, concurrency: 1, runId: "t4", retryDelaysMs });
  assert.equal(report.clean, true);
  assert.equal(report.runs.without_dropwise.retries, 2);
});

test("a run stops after its first three requests fail, instead of paying for the rest", async () => {
  await assert.rejects(
    runBenchmark({ bifrostUrl: "http://localhost:1", gatewayUrl: urls.gateway, intelligenceUrl: urls.intelligence, workload, model: LARGE, maxTokens: 2048, concurrency: 1, runId: "t5", retryDelaysMs: [] }),
    /first 3 requests all failed/,
  );
});

test("cost uses list prices, and is unknown for an unpriced model", () => {
  assert.equal(costUSD({ [LARGE]: { calls: 1, tokens_in: 1_000_000, tokens_out: 1_000_000 } }), 24);
  assert.equal(costUSD({ [SMALL]: { calls: 1, tokens_in: 2_000_000, tokens_out: 0 } }), 0.2);
  assert.equal(costUSD({ "someone/else": { calls: 1, tokens_in: 1, tokens_out: 1 } }), null);
});

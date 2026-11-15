// The cheap-benchmark route: record answers once with a spend limit, replay them in place of Bifrost.
// Everything here runs against a fake model, so no API credit is spent.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../intelligence/src/server.ts";
import { recordAnswers, worstCaseUSD } from "../bench/record.ts";
import { loadRecordings, recordKey, type Recordings, saveRecordings } from "../bench/recordings.ts";
import { createReplayServer } from "../bench/replay.ts";
import { runBenchmark } from "../bench/run.ts";
import { buildWorkload, loadPromptSet, type PromptSet } from "../bench/workload.ts";
import { loadConfig } from "../src/config.ts";
import { createDeps, createGatewayServer } from "../src/server.ts";

const LARGE = "anthropic/claude-opus-5-5";
const SMALL = "anthropic/claude-haiku-5-5";
const retryDelaysMs = [1, 1, 1];

const fake = { server: createServer(), calls: 0 };
let intelligence: Server;
let set: PromptSet;
let dir = "";
const servers: Server[] = [];

const port = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, r));

before(async () => {
  // A fake model: every answer is 100 tokens in, 400 out (so one Haiku answer costs $0.00021).
  fake.server.on("request", async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    fake.calls++;
    const user = body.messages.at(-1).content as string;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `answer: ${user.slice(0, 30)}` }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 400 } }));
  });
  intelligence = createApiServer();
  await Promise.all([listen(fake.server), listen(intelligence)]);
  servers.push(fake.server, intelligence);
  dir = await mkdtemp(join(tmpdir(), "dropwise-replay-"));
  set = await loadPromptSet();
});

after(() => servers.forEach((s) => s.close()));

const fakeUrl = () => `http://localhost:${port(fake.server)}`;
const slice = (n: number): PromptSet => ({ ...set, prompts: set.prompts.slice(0, n) });

async function gatewayFor(bifrostUrl: string) {
  const dataDir = await mkdtemp(join(dir, "gw-"));
  await writeFile(join(dataDir, "budgets.json"), JSON.stringify({ period: "day", keys: { "*": { limit_ml: 1e6 } } }));
  const config = loadConfig({ DATA_DIR: dataDir, BIFROST_URL: bifrostUrl, INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`, SMALL_MODEL: SMALL, LARGE_MODEL: LARGE });
  const gateway = createGatewayServer(await createDeps(config));
  await listen(gateway);
  servers.push(gateway);
  return `http://localhost:${port(gateway)}`;
}

const base = { model: SMALL, maxTokens: 1024, concurrency: 1, maxUsd: 0.4, retryDelaysMs } as const;

test("the recorder saves one answer per prompt, costs what it measured, and resumes without paying twice", async () => {
  const before = fake.calls;
  const first = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set: slice(6) });
  assert.equal(fake.calls - before, 6);
  assert.equal(first.recorded, 6);
  assert.equal(first.stopped, undefined);
  // 6 answers x (100 in x $0.10 + 400 out x $0.50) per million tokens
  assert.ok(Math.abs(first.spentUsd - 6 * 0.00021) < 1e-9, String(first.spentUsd));
  const answer = first.recordings.answers[recordKey(set.system_prompt, set.prompts[0].text)];
  assert.equal(answer.tokens_out, 400);

  const file = join(dir, "recordings.json");
  await saveRecordings(first.recordings, file);
  const again = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set: slice(6), existing: await loadRecordings(file) });
  assert.equal(fake.calls - before, 6, "a second run sends nothing for prompts it already has");
  assert.equal(again.recorded, 0);
  assert.equal(again.skipped, 6);

  const more = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set: slice(9), existing: first.recordings });
  assert.equal(more.recorded, 3);
  assert.equal(fake.calls - before, 9);
});

test("the recorder stops before passing its spend limit and keeps what it has", async () => {
  const before = fake.calls;
  // Each request could cost up to ~$0.0005; at $0.0008 the third would risk the limit.
  const r = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set: slice(10), maxUsd: 0.0008 });
  assert.match(r.stopped ?? "", /limit/);
  assert.equal(fake.calls - before, 2);
  assert.equal(Object.keys(r.recordings.answers).length, 2);
  assert.ok(r.spentUsd <= 0.0008);

  const none = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set: slice(10), maxUsd: 0.0000001 });
  assert.equal(none.recorded, 0);
  assert.equal(fake.calls - before, 2, "a limit too small for even one answer sends nothing");
});

test("a recorder whose first requests fail stops instead of paying for the rest", async () => {
  const r = await recordAnswers({ ...base, bifrostUrl: "http://localhost:1", set: slice(30), retryDelaysMs: [] });
  assert.match(r.stopped ?? "", /first 3 requests all failed/);
  assert.equal(r.recorded, 0);
});

test("the worst case is priced from max_tokens, and unknown models are refused", () => {
  const w = worstCaseUSD(slice(150).prompts, set.system_prompt, SMALL, 1024)!;
  assert.ok(w > 0.05 && w < 0.12, String(w));
  assert.equal(worstCaseUSD(slice(5).prompts, set.system_prompt, "someone/else", 1024), null);
});

let full: Recordings;

test("the replay server answers from the recording, whatever model the request names", async () => {
  const rec = await recordAnswers({ ...base, bifrostUrl: fakeUrl(), set, concurrency: 8 });
  full = rec.recordings;
  assert.equal(Object.keys(full.answers).length, 150);

  const server = createReplayServer(full, { latency: "none" });
  await listen(server);
  servers.push(server);
  const url = `http://localhost:${port(server)}`;
  const ask = (messages: unknown, extra: object = {}) => fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: LARGE, messages, ...extra }) });

  const p = set.prompts[3];
  const ok = await ask([{ role: "system", content: set.system_prompt }, { role: "user", content: p.text }]);
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.model, LARGE, "the response names the model that was asked for");
  assert.equal(body.choices[0].message.content, full.answers[recordKey(set.system_prompt, p.text)].content);
  assert.deepEqual(body.usage, { prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 });

  assert.equal((await ask([{ role: "system", content: set.system_prompt }, { role: "user", content: "never recorded" }])).status, 404);
  assert.equal((await ask([{ role: "user", content: p.text }], { stream: true })).status, 400);
  const info = await (await fetch(`${url}/replay`)).json();
  assert.equal(info.replay, true);
  assert.equal(info.answers, 150);
});

test("a benchmark run against the replay server is free, identical on both sides, and says it was replayed", async () => {
  const server = createReplayServer(full, { latency: "none" });
  await listen(server);
  servers.push(server);
  const replayUrl = `http://localhost:${port(server)}`;
  const gatewayUrl = await gatewayFor(replayUrl);
  const before = fake.calls;
  const workload = buildWorkload(set, { limit: 60 });

  // A $0.0001 limit would stop a live run at once; against a replay it is ignored, because nothing is spent.
  const report = await runBenchmark({ bifrostUrl: replayUrl, gatewayUrl, intelligenceUrl: `http://localhost:${port(intelligence)}`, workload, model: LARGE, maxTokens: 2048, concurrency: 4, maxUsd: 0.0001, runId: "r1", retryDelaysMs });

  assert.equal(fake.calls, before, "no model was called");
  assert.equal(report.clean, true);
  assert.equal(report.setup.replay?.model, SMALL);
  assert.equal(report.setup.replay?.answers, 150);
  assert.equal(report.runs.without_dropwise.tokens_total, 60 * 500, "every request gets its recorded answer");
  assert.equal(report.runs.with_dropwise.model_calls * 500, report.runs.with_dropwise.tokens_total);
  assert.equal(report.measured.tokens_saved, report.measured.calls_avoided * 500, "tokens saved is purely the calls Dropwise avoided");
  assert.ok(report.runs.with_dropwise.routed_small > 0, "routing is real even though the answers are replayed");
  assert.ok(report.notes.some((n) => /replayed, not generated live/.test(n)));
  assert.ok(report.notes.some((n) => /what-if/.test(n)));
  assert.ok(report.estimated.cost_usd.without_dropwise! > report.estimated.cost_usd.with_dropwise!);
});

test("a live run stops when its estimated cost passes --max-usd", async () => {
  const gatewayUrl = await gatewayFor(fakeUrl());
  const before = fake.calls;
  await assert.rejects(
    runBenchmark({ bifrostUrl: fakeUrl(), gatewayUrl, intelligenceUrl: `http://localhost:${port(intelligence)}`, workload: buildWorkload(set, { limit: 40 }), model: LARGE, maxTokens: 2048, concurrency: 1, maxUsd: 0.001, runId: "r2", retryDelaysMs }),
    /Spend guard/,
  );
  // One Opus answer (100 in, 400 out) is $0.0084, already over the limit, so the run sends one request and stops.
  assert.equal(fake.calls - before, 1);
});

// End-to-end tests: the real intelligence API (classifier + signed registry) and a fake Bifrost.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../intelligence/src/server.ts";
import { loadConfig } from "../src/config.ts";
import { estimate } from "../src/estimator.ts";
import { createDeps, createGatewayServer } from "../src/server.ts";
import type { Receipt } from "../src/types.ts";

const LARGE = "anthropic/claude-opus-5-5";
const SMALL = "anthropic/claude-haiku-5-5";

interface Upstream {
  server: Server;
  calls: { model: string; body: Record<string, unknown>; headers: Record<string, unknown> }[];
  status: number;
}

const upstream: Upstream = { server: createServer(), calls: [], status: 200 };
let intelligence: Server;
let gateway: Server;
let base = "";
let intelligenceUrl = "";

const port = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, r));

before(async () => {
  upstream.server.on("request", async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    upstream.calls.push({ model: body.model, body, headers: req.headers });
    if (upstream.status !== 200) {
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "upstream says no" } }));
    }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "there" } }], usage: { prompt_tokens: 30, completion_tokens: 2 } })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "x", model: body.model, choices: [{ message: { role: "assistant", content: `answer from ${body.model}` } }], usage: { prompt_tokens: 300, completion_tokens: 100 } }));
  });
  intelligence = createApiServer();
  await Promise.all([listen(upstream.server), listen(intelligence)]);
  intelligenceUrl = `http://localhost:${port(intelligence)}`;

  const dataDir = await mkdtemp(join(tmpdir(), "dropwise-gw-"));
  await writeFile(join(dataDir, "budgets.json"), JSON.stringify({ period: "day", keys: { tiny: { limit_ml: 2 }, "*": { limit_ml: 1000 } } }));
  const config = loadConfig({ DATA_DIR: dataDir, BIFROST_URL: `http://localhost:${port(upstream.server)}`, INTELLIGENCE_URL: intelligenceUrl, SMALL_MODEL: SMALL, LARGE_MODEL: LARGE });
  gateway = createGatewayServer(await createDeps(config));
  await listen(gateway);
  base = `http://localhost:${port(gateway)}`;
});

after(() => {
  for (const s of [gateway, intelligence, upstream.server]) s.close();
});

async function chat(prompt: string, opts: { model?: string; key?: string; stream?: boolean } = {}) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.key ? { "x-bf-vk": opts.key } : {}) },
    body: JSON.stringify({ model: opts.model ?? LARGE, messages: [{ role: "user", content: prompt }], ...(opts.stream ? { stream: true } : {}) }),
  });
  const id = res.headers.get("x-dropwise-request-id");
  const text = await res.text();
  const receipt = id ? ((await (await fetch(`${base}/receipts/${id}`)).json()) as Receipt) : null;
  return { res, text, receipt };
}

test("an easy prompt asked of the large model is routed small, with a cited water range", async () => {
  const { res, text, receipt } = await chat("Fix the typo in this sentence: teh cat sat");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-dropwise-routed-to"), SMALL);
  assert.match(text, /answer from anthropic\/claude-haiku-5-5/);
  assert.ok(receipt);
  assert.equal(receipt.model, LARGE);
  assert.equal(receipt.routed_to, SMALL);
  assert.equal(receipt.route?.tier, "small");
  assert.equal(receipt.tokens_in, 300);
  assert.equal(receipt.tokens_out, 100);
  assert.equal(receipt.factor_versions.length, 4);
  for (const f of receipt.factor_versions) assert.match(f, /^[a-z0-9-]+@sha256:[0-9a-f]{64}$/);
  const w = receipt.water_ml_by_scope!;
  assert.ok(w.direct_only.low > 0 && w.direct_only.low <= w.direct_only.high);
  assert.ok(w.direct_plus_indirect.high > w.direct_only.high, "indirect adds water");
  assert.deepEqual(receipt.water_ml, w.direct_plus_indirect);
  assert.match(res.headers.get("x-dropwise-water-ml") ?? "", /estimated/);
});

test("the estimate matches the registry formula: 400 tokens at 0.24-0.34 Wh x (0.27 + 4.52) L/kWh", async () => {
  const registry = await (await fetch(`${intelligenceUrl}/registry`)).json();
  const e = estimate(registry, 400);
  assert.deepEqual(e.energy_wh, { low: 0.24, high: 0.34 });
  assert.deepEqual(e.water_ml_by_scope.direct_only, { low: 0.0648, high: 0.0918 });
  assert.deepEqual(e.water_ml_by_scope.direct_plus_indirect, { low: 1.1496, high: 1.6286 });
});

test("receipts carry exactly the fields in contracts/water-receipt.schema.json", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/water-receipt.schema.json", import.meta.url), "utf8"));
  const { receipt } = await chat("Fix the typo: adress");
  const keys = Object.keys(receipt!);
  for (const k of schema.required) assert.ok(keys.includes(k), `missing ${k}`);
  for (const k of keys) assert.ok(k in schema.properties, `not in schema: ${k}`);
  assert.match(receipt!.request_id, new RegExp(schema.properties.request_id.pattern));
});

test("a hard prompt keeps the large model", async () => {
  const { receipt } = await chat("Is 2^31 - 1 prime?");
  assert.equal(receipt?.routed_to, LARGE);
  assert.equal(receipt?.route?.tier, "large");
});

test("dropwise/auto picks the model from the classifier", async () => {
  const easy = await chat("Translate this short reply into Tamil: thank you", { model: "dropwise/auto" });
  const hard = await chat("Is 2^31 - 1 prime?", { model: "dropwise/auto" });
  assert.equal(easy.receipt?.routed_to, SMALL);
  assert.equal(hard.receipt?.routed_to, LARGE);
});

test("a repeat evergreen prompt is served from cache: no model call, no inference water", async () => {
  const first = await chat("Explain how evaporative cooling works");
  const callsBefore = upstream.calls.length;
  const second = await chat("  explain how evaporative   cooling works. ");
  assert.equal(first.receipt?.cache, "miss");
  assert.equal(second.receipt?.cache, "hit");
  assert.equal(second.receipt?.cache_hit, true);
  assert.equal(upstream.calls.length, callsBefore, "no upstream call on a hit");
  assert.equal(second.text, first.text);
  assert.deepEqual(second.receipt?.water_ml, { low: 0, high: 0 });
  assert.equal(second.receipt?.tokens_saved, 400);
  assert.ok(second.receipt!.avoided_ml_by_scope!.direct_plus_indirect.high > 0);
});

test("cache entries are per virtual key: one team never gets another team's cached answer", async () => {
  const a = await chat("Name three primary colours", { key: "team-a" });
  const again = await chat("Name three primary colours", { key: "team-a" });
  const b = await chat("Name three primary colours", { key: "team-b" });
  assert.equal(a.receipt?.cache, "miss");
  assert.equal(again.receipt?.cache, "hit");
  assert.equal(b.receipt?.cache, "miss");
});

test("x-dropwise-key takes precedence over x-bf-vk, which is still forwarded to Bifrost", async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dropwise-key": "team-x", "x-bf-vk": "sk-bf-team" },
    body: JSON.stringify({ model: LARGE, messages: [{ role: "user", content: "Spell 'necessary' backwards" }] }),
  });
  const r = (await (await fetch(`${base}/receipts/${res.headers.get("x-dropwise-request-id")}`)).json()) as Receipt;
  assert.equal(r.virtual_key, "team-x");
  assert.equal(upstream.calls.at(-1)?.headers["x-bf-vk"], "sk-bf-team");
});

test("a time-sensitive prompt bypasses the cache every time", async () => {
  const before = upstream.calls.length;
  const a = await chat("What's the weather in Chennai right now?");
  const b = await chat("What's the weather in Chennai right now?");
  assert.equal(a.receipt?.cache, "bypass");
  assert.equal(b.receipt?.cache, "bypass");
  assert.equal(upstream.calls.length, before + 2);
  assert.equal(a.res.headers.get("x-dropwise-cache"), "bypass");
});

test("budgets alert at 80% and flag a soft limit at 100%, while still serving", async () => {
  const states: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { res, receipt } = await chat(`Is ${1000003 + i * 2} a prime number? Show the reasoning.`, { key: "tiny" });
    assert.equal(res.status, 200);
    states.push(receipt!.budget!.status);
  }
  assert.ok(states.includes("soft_limit"), `got ${states.join(",")}`);
  const budgets = await (await fetch(`${base}/budgets`)).json();
  const tiny = budgets.budgets.find((b: { virtual_key: string }) => b.virtual_key === "tiny");
  assert.equal(tiny.status, "soft_limit");
  assert.ok(budgets.alerts.some((a: { virtual_key: string; status: string }) => a.virtual_key === "tiny" && a.status === "soft_limit"));
});

test("summary separates measured counts from estimated water", async () => {
  const s = await (await fetch(`${base}/summary`)).json();
  assert.ok(s.measured.cache_hits >= 1);
  assert.equal(s.measured.calls_avoided, s.measured.cache_hits);
  assert.ok(s.measured.routed_small >= 2);
  assert.ok(s.measured.tokens_saved >= 400);
  const e = s.estimated;
  assert.ok(e.water_ml_without_dropwise.high > e.water_ml_with_dropwise.high);
  const direct = await (await fetch(`${base}/summary?scope=direct_only`)).json();
  assert.ok(direct.estimated.water_ml_with_dropwise.high < e.water_ml_with_dropwise.high);
});

test("receipts list filters by cache outcome", async () => {
  const hits = (await (await fetch(`${base}/receipts?cache=hit`)).json()) as Receipt[];
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((r) => r.cache === "hit"));
  assert.equal((await fetch(`${base}/receipts/req_nope`)).status, 404);
});

test("streaming passes through and still writes a receipt", async () => {
  const { res, text } = await chat("Say hello", { stream: true });
  assert.equal(res.status, 200);
  assert.match(text, /Hello /);
  const id = /request_id=(req_[a-z0-9]+)/.exec(text)?.[1];
  assert.ok(id);
  const r = (await (await fetch(`${base}/receipts/${id}`)).json()) as Receipt;
  assert.equal(r.cache, "skipped");
  assert.equal(r.tokens_out, 2);
});

test("upstream errors pass through unchanged and write no receipt", async () => {
  upstream.status = 529;
  try {
    const { res, receipt } = await chat("Fix the typo: helo");
    assert.equal(res.status, 529);
    assert.equal(receipt, null);
  } finally {
    upstream.status = 200;
  }
});

test("the live feed streams receipts as they happen", async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  await reader.read(); // ": connected"
  await chat("Fix the typo: recieve");
  let seen = "";
  while (!seen.includes("event: receipt")) seen += new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  assert.match(seen, /"cache":"miss"/);
});

test("without the classifier the gateway fails safe: requested model, cache skipped", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "dropwise-gw-"));
  const config = loadConfig({ DATA_DIR: dataDir, BIFROST_URL: `http://localhost:${port(upstream.server)}`, INTELLIGENCE_URL: "http://localhost:1", SMALL_MODEL: SMALL, LARGE_MODEL: LARGE });
  const lone = createGatewayServer(await createDeps(config));
  await listen(lone);
  try {
    const res = await fetch(`http://localhost:${port(lone)}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: LARGE, messages: [{ role: "user", content: "Fix the typo: helo" }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-dropwise-routed-to"), LARGE);
    assert.equal(res.headers.get("x-dropwise-cache"), "bypass");
    const r = (await (await fetch(`http://localhost:${port(lone)}/receipts/${res.headers.get("x-dropwise-request-id")}`)).json()) as Receipt;
    assert.equal(r.water_ml, null);
    assert.match(r.route_note ?? "", /Classifier unavailable/);
  } finally {
    lone.close();
  }
});

test("bad requests get a 400", async () => {
  const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }) });
  assert.equal(res.status, 400);
});

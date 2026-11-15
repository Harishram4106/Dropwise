import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { classifyCounts, decomposeByRules, onlyUsesClaimFigures } from "../src/claims/decompose.ts";
import { parseQuantity } from "../src/claims/quantity.ts";
import { judge, type Evidence } from "../src/claims/verdict.ts";
import { createApiServer } from "../src/server.ts";

const evidence = (overrides: Partial<Evidence>): Evidence => ({
  label: "Example",
  short: "Example",
  range: { low: 1, high: 1 },
  unit: "mL per prompt",
  counts: "direct_only",
  source_url: "https://example.com",
  source_date: "2025-08-21",
  freshness_score: 0.66,
  stale: false,
  subjects: [],
  ...overrides,
});

const google = evidence({ short: "Google", range: { low: 0.26, high: 0.26 }, subjects: ["gemini", "google"], source_url: "https://example.com/google", factor_id: "google" });
const ucr = evidence({ short: "UCR", range: { low: 10, high: 50 }, unit: "mL per response", counts: "direct_plus_indirect", subjects: ["gpt-3", "chatgpt"], source_url: "https://example.com/ucr", factor_id: "ucr" });
const openaiEnergy = evidence({ short: "OpenAI", range: { low: 0.34, high: 0.34 }, unit: "Wh per query", counts: "not_applicable", subjects: ["chatgpt"], factor_id: "openai-energy" });
const all = [google, ucr, openaiEnergy];

const check = (claim: string, ev: Evidence[] = all) => decomposeByRules(claim).map((a) => judge(a, ev));

test("household measures convert to mL", () => {
  assert.equal(parseQuantity("uses a bottle of water per query")?.low, 500);
  assert.equal(parseQuantity("about five drops of water")?.low, 0.25);
  assert.equal(parseQuantity("one fifteenth of a teaspoon")?.low, 0.3287);
  assert.equal(parseQuantity("0.000085 gallons per query")?.low, 0.3218);
  assert.equal(parseQuantity("half a liter")?.low, 500);
  assert.deepEqual(
    [parseQuantity("2 kWh")?.low, parseQuantity("2 kWh")?.kind],
    [2000, "energy"],
  );
});

test("'a bottle for 10-50 responses' becomes 10-50 mL per response", () => {
  const q = parseQuantity("GPT-3 needs a 500ml bottle of water for 10-50 medium-length responses");
  assert.deepEqual([q?.low, q?.high, q?.per], [10, 50, "response"]);
});

test("words that merely contain number words are not quantities", () => {
  assert.equal(parseQuantity("the total water used is high"), null);
  assert.equal(parseQuantity("a lot of water"), null);
  assert.equal(parseQuantity("a 100-word email"), null);
});

test("rules split only clauses that each carry a figure, and keep the subject", () => {
  assert.deepEqual(
    decomposeByRules("Every AI query uses a teaspoon of water and 3 Wh of electricity").map((a) => a.text),
    ["Every AI query uses a teaspoon of water", "Every AI query uses 3 Wh of electricity"],
  );
  assert.equal(decomposeByRules("A query uses a bottle of water for cooling and electricity").length, 1);
});

test("counts classification", () => {
  assert.equal(classifyCounts("a bottle of water for cooling"), "direct_only");
  assert.equal(classifyCounts("water used to generate the electricity"), "indirect_only");
  assert.equal(classifyCounts("lifecycle water per response"), "direct_plus_indirect");
  assert.equal(classifyCounts("3 Wh of electricity"), "not_applicable");
  assert.equal(classifyCounts("a bottle of water"), "unclear");
});

test("model decomposition may not introduce figures or units", () => {
  const claim = "One ChatGPT query uses a bottle of water";
  assert.ok(onlyUsesClaimFigures("A ChatGPT query uses a bottle of water", claim));
  assert.ok(!onlyUsesClaimFigures("A ChatGPT query uses 500 mL of water", claim));
});

test("the bottle-per-query claim is overstated against the subject's sources", () => {
  const [a] = check("One ChatGPT query uses a bottle of water");
  assert.equal(a.verdict, "overstated");
  assert.match(a.explanation, /10x the highest published estimate/);
  assert.deepEqual(a.registry_factors, ["ucr"]);
});

test("a figure matching a current source is supported", () => {
  const [a] = check("A Gemini prompt uses about five drops of water");
  assert.equal(a.verdict, "supported");
  assert.deepEqual(a.sources, ["https://example.com/google"]);
});

test("a figure below every source is understated", () => {
  assert.equal(check("Each AI prompt uses 0.001 mL of water")[0].verdict, "understated");
});

test("a figure between sources with none agreeing is unsupported", () => {
  assert.equal(check("Every AI query uses a teaspoon of water")[0].verdict, "unsupported");
});

test("agreeing only with a superseded source is outdated", () => {
  const staleUcr = { ...ucr, stale: true };
  assert.equal(check("A GPT-3 response uses 30 mL of water", [google, staleUcr])[0].verdict, "outdated");
});

test("energy claims are compared with energy figures only", () => {
  const [a] = check("A ChatGPT query uses 3 Wh");
  assert.equal(a.verdict, "overstated");
  assert.deepEqual(a.registry_factors, ["openai-energy"]);
});

test("claims without a figure or per-prompt basis are unsupported", () => {
  assert.equal(check("AI uses a lot of water")[0].claimed, null);
  assert.match(check("ChatGPT uses half a liter per conversation")[0].explanation, /per conversation/);
});

test("API checks claims and rejects bad input", async () => {
  const server = createApiServer().listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const ok = await fetch(`${base}/claims/check`, { method: "POST", body: JSON.stringify({ claim: "AI uses a lot of water" }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).atomic_claims[0].verdict, "unsupported");

    const bad = await fetch(`${base}/claims/check`, { method: "POST", body: "{}" });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/registry/does-not-exist`)).status, 404);
  } finally {
    server.close();
  }
});

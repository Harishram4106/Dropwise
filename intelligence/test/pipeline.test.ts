import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candidate, FactorSpec, RegistryEntry } from "../src/contracts.ts";
import { candidateSentences, dateFromUrl, parseExtraction } from "../src/extract.ts";
import { freshnessScore } from "../src/freshness.ts";
import { baseUnit, reconcile } from "../src/pipeline.ts";
import { buildReview } from "../src/review.ts";

const now = new Date("2026-11-08T00:00:00Z");

const spec: FactorSpec = {
  factor_id: "google-gemini-median-prompt-water",
  label: "Water per median prompt",
  unit: "mL per prompt",
  counts: "direct_only",
  role: "reference",
  query: "q",
};

const result = {
  title: "Paper",
  url: "https://example.com/paper",
  score: 0.9,
  published_date: "2025-08-21",
  content: "Intro text. The median prompt consumes 0.26 mL of water, about five drops. Unrelated sentence.",
};

const entry: RegistryEntry = {
  factor_id: spec.factor_id,
  label: spec.label,
  value: 0.26,
  range: { low: 0.26, high: 0.26 },
  unit: "mL per prompt",
  counts: "direct_only",
  source_url: "https://example.com/paper",
  source_title: "Paper",
  source_date: "2025-08-21",
  evidence: "",
  freshness_score: 0,
  last_verified: "2026-01-01",
  verified_by: "manual",
  status: "verified",
  version_hash: "",
};

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  factor_id: spec.factor_id,
  value: 0.26,
  range: { low: 0.26, high: 0.26 },
  unit: "mL per prompt",
  counts: "direct_only",
  source_url: "https://example.com/paper",
  source_title: "Paper",
  source_date: "2025-08-21",
  evidence: "",
  found_at: now.toISOString(),
  ...overrides,
});

test("freshness halves every two years and accepts month precision", () => {
  assert.equal(freshnessScore("2026-11-08", now), 1);
  assert.equal(freshnessScore("2024-11-08", now), 0.5);
  assert.ok(freshnessScore("2025-06", now) < freshnessScore("2025-06-30", now));
});

test("only sentences with a number and a unit are sent to the model", () => {
  assert.deepEqual(candidateSentences(result.content), ["The median prompt consumes 0.26 mL of water, about five drops."]);
});

test("extraction is accepted when the quote is in the source", () => {
  const c = parseExtraction(
    { found: true, value: 0.26, low: 0.26, high: 0.26, unit: "mL per prompt", counts: "direct_only", source_date: null, evidence: "consumes 0.26 mL of water" },
    spec,
    result,
    now,
  );
  assert.equal(c?.value, 0.26);
  assert.equal(c?.source_date, "2025-08-21");
});

test("a missing date is read from the URL and marked as inferred", () => {
  const undated = { ...result, published_date: undefined, url: "https://eta-publications.lbl.gov/sites/default/files/2024-12/report.pdf" };
  const raw = { found: true, value: 0.26, low: 0.26, high: 0.26, unit: "mL per prompt", counts: "direct_only", source_date: null, evidence: "consumes 0.26 mL of water" };
  const c = parseExtraction(raw, spec, undated, now);
  assert.equal(c?.source_date, "2024-12");
  assert.equal(c?.source_date_inferred, "url");
  // A date the model or the source stated is never overridden, and is not marked.
  const stated = parseExtraction({ ...raw, source_date: "2025-03" }, spec, undated, now);
  assert.equal(stated?.source_date, "2025-03");
  assert.equal(stated?.source_date_inferred, undefined);
  // No date anywhere: still rejected.
  assert.equal(parseExtraction(raw, spec, { ...undated, url: "https://example.com/report.pdf" }, now), null);
});

test("dates in URLs: plausible ones only", () => {
  assert.equal(dateFromUrl("https://a.org/files/2024-12/x.pdf", now), "2024-12");
  assert.equal(dateFromUrl("https://a.org/2025/03/14/post", now), "2025-03-14");
  assert.equal(dateFromUrl("https://a.org/x-2024-12-report.pdf", now), null); // not a path segment
  assert.equal(dateFromUrl("https://a.org/files/2031-01/x.pdf", now), null); // in the future
  assert.equal(dateFromUrl("https://a.org/files/2024-13/x.pdf", now), null); // not a month
  assert.equal(dateFromUrl("not a url", now), null);
});

test("extraction is rejected when the quote was invented", () => {
  const c = parseExtraction(
    { found: true, value: 500, low: 500, high: 500, unit: "mL per prompt", counts: "direct_only", source_date: "2025", evidence: "each prompt uses a bottle of water" },
    spec,
    result,
    now,
  );
  assert.equal(c, null);
});

test("extraction is rejected when the value falls outside its own range", () => {
  const c = parseExtraction(
    { found: true, value: 3, low: 0.26, high: 0.26, unit: "mL", counts: "direct_only", source_date: "2025", evidence: "consumes 0.26 mL of water" },
    spec,
    result,
    now,
  );
  assert.equal(c, null);
});

test("units written 'L/kWh' and 'L per kWh' count as the same unit", () => {
  assert.equal(baseUnit("L/kWh"), baseUnit("L per kWh"));
  assert.equal(baseUnit("mL / prompt"), baseUnit("mL per prompt"));
  assert.notEqual(baseUnit("mL per prompt"), baseUnit("Wh per prompt"));
  const newer = candidate({ unit: "L/kWh", source_url: "https://example.com/2026-update", source_date: "2026-09-01", range: { low: 0.4, high: 0.4 }, value: 0.4 });
  assert.equal(reconcile({ ...entry, unit: "L per kWh" }, [newer], now).outcome.action, "flagged_stale");
});

test("re-finding the same source reconfirms the entry", () => {
  const { entry: updated, outcome } = reconcile(entry, [candidate({})], now);
  assert.equal(outcome.action, "reconfirmed");
  assert.equal(updated.last_verified, "2026-11-08");
  assert.equal(updated.verified_by, "tavily");
});

test("a newer source with a different figure flags the entry stale", () => {
  const newer = candidate({ source_url: "https://example.com/2026-update", source_date: "2026-09-01", range: { low: 0.4, high: 0.4 }, value: 0.4 });
  const { entry: updated, outcome } = reconcile(entry, [newer], now);
  assert.equal(outcome.action, "flagged_stale");
  assert.equal(updated.status, "stale");
  assert.equal(updated.superseded_by, "https://example.com/2026-update");
});

test("a newer source that agrees, or uses another unit, does not flag stale", () => {
  const agreeing = candidate({ source_url: "https://example.com/other", source_date: "2026-09-01" });
  const otherUnit = candidate({ source_url: "https://example.com/energy", source_date: "2026-09-01", unit: "Wh per prompt", range: { low: 0.24, high: 0.24 } });
  assert.equal(reconcile(entry, [agreeing, otherUnit], now).outcome.action, "not_found_again");
});

test("the review list pairs each waiting candidate with what the registry holds, and skips empty groups", () => {
  const found = candidate({ source_url: "https://example.com/new", source_date: "2026-09" });
  const groups = buildReview({ [spec.factor_id]: [found], "no-entry-yet": [candidate({ factor_id: "no-entry-yet" })], "empty-one": [] }, [spec], [entry], now);
  assert.deepEqual(groups.map((g) => g.factor_id), ["google-gemini-median-prompt-water", "no-entry-yet"]);
  assert.equal(groups[0].label, "Water per median prompt");
  assert.equal(groups[0].current?.source_url, entry.source_url);
  assert.equal(groups[0].current?.freshness_score, freshnessScore(entry.source_date, now));
  assert.equal(groups[0].items[0].accept_command, "npm run registry -- accept google-gemini-median-prompt-water 0");
  assert.equal(groups[1].current, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { staleDemo } from "../src/demo.ts";
import { ENTRIES_FILE } from "../src/paths.ts";
import { createApiServer } from "../src/server.ts";

const now = new Date("2026-11-10T00:00:00Z");

test("the 2016 figure is flagged stale by the 2024 report, without touching the signed registry", async () => {
  const registryBefore = await readFile(ENTRIES_FILE, "utf8");
  const d = await staleDemo({ now });

  assert.equal(d.mode, "fixture");
  assert.equal(d.before.status, "verified");
  assert.equal(d.after.status, "stale");
  assert.equal(d.outcome.action, "flagged_stale");
  assert.equal(d.after.superseded_by, d.newer_source?.source_url);
  assert.match(d.after.superseded_by ?? "", /lbnl-2024/);
  assert.notEqual(d.after.version_hash, d.before.version_hash, "the stale flag changes the entry hash");
  assert.match(d.explanation, /7\.6 L per kWh[\s\S]*4\.52 L per kWh/);

  assert.equal(await readFile(ENTRIES_FILE, "utf8"), registryBefore);
});

test("live mode without keys falls back to the captured result", async () => {
  const saved = { t: process.env.TAVILY_API_KEY, m: process.env.EXTRACTION_MODEL };
  delete process.env.TAVILY_API_KEY;
  delete process.env.EXTRACTION_MODEL;
  try {
    const d = await staleDemo({ live: true, now });
    assert.equal(d.mode, "fixture");
    assert.match(d.warning ?? "", /Live refresh unavailable/);
    assert.equal(d.after.status, "stale");
  } finally {
    if (saved.t !== undefined) process.env.TAVILY_API_KEY = saved.t;
    if (saved.m !== undefined) process.env.EXTRACTION_MODEL = saved.m;
  }
});

test("API serves the stale demo", async () => {
  const server = createApiServer().listen(0);
  try {
    const res = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/demo/stale-factor`);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.deepEqual([d.before.status, d.after.status, d.mode], ["verified", "stale", "fixture"]);
  } finally {
    server.close();
  }
});

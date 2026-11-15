import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegistryEntry } from "../src/contracts.ts";
import { buildVersion, canonicalize, entryHash, generateKeyPair, verifyChain } from "../src/integrity.ts";
import { refreshDerived } from "../src/store.ts";

const entry: RegistryEntry = refreshDerived({
  factor_id: "example",
  label: "Example",
  value: 1,
  range: { low: 1, high: 1 },
  unit: "mL per prompt",
  counts: "direct_only",
  source_url: "https://example.com",
  source_title: "Example",
  source_date: "2025-01-01",
  evidence: "Example says 1 mL.",
  freshness_score: 0,
  last_verified: "2026-11-08",
  verified_by: "manual",
  status: "verified",
  version_hash: "",
});

test("canonicalize is key-order independent", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalize({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("entry hash ignores freshness but tracks content", () => {
  assert.equal(entryHash({ ...entry, freshness_score: 0.1 }), entry.version_hash);
  assert.notEqual(entryHash({ ...entry, range: { low: 1, high: 2 } }), entry.version_hash);
});

test("a published chain verifies, and tampering is detected", () => {
  const keys = generateKeyPair();
  const v1 = buildVersion([entry], null, keys);
  const v2 = buildVersion([entry], v1, keys);
  assert.deepEqual(verifyChain([v1, v2], keys.publicPem), []);

  const tampered = { ...v1, entries: [{ ...entry, value: 0.01 }] };
  const problems = verifyChain([tampered, v2], keys.publicPem);
  assert.ok(problems.some((p) => p.includes("registry_hash")));
  assert.ok(problems.some((p) => p.includes("version_hash")));
});

test("a version signed with another key fails", () => {
  const v1 = buildVersion([entry], null, generateKeyPair());
  assert.ok(verifyChain([v1], generateKeyPair().publicPem).some((p) => p.includes("signature")));
});

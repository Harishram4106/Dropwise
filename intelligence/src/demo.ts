// Demo step 4: a registry factor flagged stale because Tavily found a newer source.
//
// It runs the same reconcile() a real refresh uses, on a demo copy of one factor, so the signed
// registry is never changed. "fixture" mode uses the newer source already captured from Tavily
// (deterministic, works offline on judging day); "live" mode searches Tavily and extracts through
// Bifrost, and falls back to the fixture if either is unavailable.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Candidate, RegistryEntry } from "./contracts.ts";
import { REGISTRY_DIR } from "./paths.ts";
import { findCandidates, formatRange, reconcile, type RefreshOutcome } from "./pipeline.ts";
import { loadFactors, refreshDerived } from "./store.ts";

export const STALE_DEMO_FILE = join(REGISTRY_DIR, "demo", "stale-factor.json");

interface StaleFixture {
  description: string;
  entry: RegistryEntry;
  newer: Candidate;
}

export interface StaleDemoResult {
  mode: "fixture" | "live";
  warning?: string;
  before: RegistryEntry;
  after: RegistryEntry;
  outcome: RefreshOutcome;
  newer_source: Candidate | null;
  explanation: string;
}

export async function staleDemo(options: { live?: boolean; now?: Date; file?: string } = {}): Promise<StaleDemoResult> {
  const now = options.now ?? new Date();
  const fixture = JSON.parse(await readFile(options.file ?? STALE_DEMO_FILE, "utf8")) as StaleFixture;
  const before = refreshDerived(fixture.entry, now);

  let mode: StaleDemoResult["mode"] = "fixture";
  let warning: string | undefined;
  let candidates: Candidate[] = [fixture.newer];

  if (options.live) {
    try {
      if (!process.env.TAVILY_API_KEY || !process.env.EXTRACTION_MODEL) throw new Error("TAVILY_API_KEY and EXTRACTION_MODEL are needed");
      const spec = (await loadFactors()).find((s) => s.factor_id === before.factor_id);
      if (!spec) throw new Error(`No factor spec ${before.factor_id}`);
      const found = await findCandidates(spec, now);
      if (!found.length) throw new Error("live search returned no usable figure");
      candidates = found;
      mode = "live";
    } catch (err) {
      const message = (err as Error).message === "fetch failed" ? `could not reach Bifrost at ${process.env.BIFROST_URL || "http://localhost:8080"}` : (err as Error).message;
      warning = `Live refresh unavailable (${message}); used the captured Tavily result instead.`;
    }
  }

  const { entry, outcome } = reconcile(before, candidates, now);
  const after = refreshDerived(entry, now);
  const newer = candidates.find((c) => c.source_url === after.superseded_by) ?? null;

  const explanation =
    outcome.action === "flagged_stale" && newer
      ? `${before.source_title} gave ${formatRange(before.range)} ${before.unit}. Tavily found a newer source, ` +
        `${newer.source_title} (${newer.source_date}), giving ${formatRange(newer.range)} ${newer.unit}. ` +
        `It is newer, uses the same unit and the ranges don't overlap, so the entry is flagged stale and the new figure waits for review. ` +
        `Age alone never flags an entry.`
      : `No newer, conflicting source was found, so the entry stays ${after.status} (${outcome.action}).`;

  return { mode, warning, before, after, outcome, newer_source: newer, explanation };
}

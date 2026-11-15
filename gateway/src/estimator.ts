// Footprint estimator: tokens -> energy range -> water range, every factor read from the signed registry.
//
//   energy (Wh)  = energy per prompt (low..high) x (tokens / REFERENCE_TOKENS)
//   water (mL)   = energy (Wh) x water factor (L per kWh)       since 1 Wh x 1 L/kWh = 1 mL
//   direct_only          uses on-site data-center WUE
//   direct_plus_indirect adds the water behind the electricity (EWIF)
//
// The registry has no per-token or per-model energy figure (sources state energy per prompt), so every
// model uses the same per-prompt range and length scaling is an assumption, stated in `method`.

import type { Range, RegistryEntry, RegistrySnapshot, Scope } from "./types.ts";

export const REFERENCE_TOKENS = 400;

export const FACTORS = {
  energyLow: "google-gemini-median-prompt-energy",
  energyHigh: "openai-chatgpt-average-query-energy",
  directWater: "datacenter-wue-onsite",
  indirectWater: "electricity-water-intensity",
} as const;

export const METHOD =
  `energy per prompt (Google median to OpenAI average) x (tokens / ${REFERENCE_TOKENS}, assumed linear) x water factor ` +
  "(Microsoft on-site WUE; plus LBNL US grid water for indirect). Provider region not disclosed, so US averages are assumed.";

export interface Estimate {
  energy_wh: Range;
  water_ml_by_scope: Record<Scope, Range>;
  factor_versions: string[];
}

const round = (n: number) => Math.round(n * 10000) / 10000;

function factor(registry: RegistrySnapshot, id: string): RegistryEntry {
  const entry = registry.entries.find((e) => e.factor_id === id);
  if (!entry) throw new Error(`Registry has no entry ${id}`);
  return entry;
}

export function estimate(registry: RegistrySnapshot, tokens: number): Estimate {
  const eLow = factor(registry, FACTORS.energyLow);
  const eHigh = factor(registry, FACTORS.energyHigh);
  const direct = factor(registry, FACTORS.directWater);
  const indirect = factor(registry, FACTORS.indirectWater);

  const scale = Math.max(0, tokens) / REFERENCE_TOKENS;
  const energy: Range = {
    low: Math.min(eLow.range.low, eHigh.range.low) * scale,
    high: Math.max(eLow.range.high, eHigh.range.high) * scale,
  };
  const water = (wue: Range): Range => ({ low: round(energy.low * wue.low), high: round(energy.high * wue.high) });
  const total: Range = { low: direct.range.low + indirect.range.low, high: direct.range.high + indirect.range.high };

  return {
    energy_wh: { low: round(energy.low), high: round(energy.high) },
    water_ml_by_scope: { direct_only: water(direct.range), direct_plus_indirect: water(total) },
    factor_versions: [eLow, eHigh, direct, indirect].map((e) => `${e.factor_id}@${e.version_hash}`),
  };
}

export const ZERO: Range = { low: 0, high: 0 };

export function addRange(a: Range, b: Range): Range {
  return { low: round(a.low + b.low), high: round(a.high + b.high) };
}

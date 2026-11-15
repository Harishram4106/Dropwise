// Receipt store: one JSON line per request in data/receipts.jsonl, kept in memory for the API,
// plus an event stream the dashboard's live meter subscribes to.

import { EventEmitter } from "node:events";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { addRange, ZERO } from "./estimator.ts";
import type { Range, Receipt, Scope } from "./types.ts";

export interface ReceiptFilter {
  virtual_key?: string;
  cache?: string;
  limit?: number;
}

export interface Summary {
  scope: Scope;
  virtual_key: string | null;
  measured: {
    requests: number;
    model_calls: number;
    cache_hits: number;
    calls_avoided: number;
    cache_bypassed: number;
    routed_small: number;
    routed_small_share: number;
    tokens_in: number;
    tokens_out: number;
    tokens_saved: number;
    gateway_latency_ms: { p50: number; p95: number };
  };
  estimated: {
    water_ml_without_dropwise: Range;
    water_ml_with_dropwise: Range;
    water_ml_avoided: Range;
  };
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

export class ReceiptStore {
  readonly events = new EventEmitter();
  private receipts: Receipt[] = [];
  private file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
    this.events.setMaxListeners(100);
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.file, "utf8");
      this.receipts = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Receipt);
    } catch {
      this.receipts = [];
    }
  }

  async add(receipt: Receipt): Promise<void> {
    this.receipts.push(receipt);
    // One append at a time, so lines from concurrent requests never interleave.
    // A failed write must not block the ones after it.
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, JSON.stringify(receipt) + "\n");
    });
    await this.writing;
    this.events.emit("receipt", receipt);
  }

  get(id: string): Receipt | undefined {
    return this.receipts.find((r) => r.request_id === id);
  }

  list(filter: ReceiptFilter = {}): Receipt[] {
    const matching = this.receipts.filter(
      (r) => (!filter.virtual_key || r.virtual_key === filter.virtual_key) && (!filter.cache || r.cache === filter.cache),
    );
    return matching.slice(-(filter.limit ?? 50)).reverse();
  }

  summary(scope: Scope, virtualKey?: string): Summary {
    const rs = this.receipts.filter((r) => !virtualKey || r.virtual_key === virtualKey);
    const hits = rs.filter((r) => r.cache_hit);
    const calls = rs.filter((r) => !r.cache_hit);
    const routedSmall = calls.filter((r) => r.route?.tier === "small" && r.routed_to !== r.model);
    let withDropwise = ZERO;
    let avoided = ZERO;
    for (const r of rs) {
      if (r.water_ml_by_scope) withDropwise = addRange(withDropwise, r.water_ml_by_scope[scope]);
      if (r.avoided_ml_by_scope) avoided = addRange(avoided, r.avoided_ml_by_scope[scope]);
    }
    const gateway = rs.map((r) => r.latency_ms.gateway);
    return {
      scope,
      virtual_key: virtualKey ?? null,
      measured: {
        requests: rs.length,
        model_calls: calls.length,
        cache_hits: hits.length,
        calls_avoided: hits.length,
        cache_bypassed: rs.filter((r) => r.cache === "bypass").length,
        routed_small: routedSmall.length,
        routed_small_share: calls.length ? Math.round((routedSmall.length / calls.length) * 1000) / 1000 : 0,
        tokens_in: rs.reduce((n, r) => n + r.tokens_in, 0),
        tokens_out: rs.reduce((n, r) => n + r.tokens_out, 0),
        tokens_saved: rs.reduce((n, r) => n + r.tokens_saved, 0),
        gateway_latency_ms: { p50: percentile(gateway, 50), p95: percentile(gateway, 95) },
      },
      estimated: {
        water_ml_without_dropwise: addRange(withDropwise, avoided),
        water_ml_with_dropwise: withDropwise,
        water_ml_avoided: avoided,
      },
    };
  }
}

// Water budgets per virtual key. Usage counts the HIGH end of each request's estimated range, so a
// budget is never under-counted. Soft limits: requests over budget are still served, but flagged,
// and an alert is raised once when a key crosses 80% and once at 100%.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { addRange, ZERO } from "./estimator.ts";
import type { BudgetState, BudgetStatus, Range, Scope } from "./types.ts";

export interface BudgetLimit {
  limit_ml: number;
  scope?: Scope;
}

export interface BudgetConfig {
  period: "day" | "month";
  keys: Record<string, BudgetLimit>;
}

export interface BudgetAlert {
  at: string;
  virtual_key: string;
  period: string;
  status: BudgetStatus;
  used_pct: number;
}

interface Usage {
  [periodAndKey: string]: Range;
}

const ALERT_PCT = 80;

export function periodOf(config: BudgetConfig, now = new Date()): string {
  const iso = now.toISOString();
  return config.period === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

export function statusFor(pct: number): BudgetStatus {
  return pct >= 100 ? "soft_limit" : pct >= ALERT_PCT ? "alert" : "ok";
}

export class Budgets {
  config: BudgetConfig = { period: "day", keys: {} };
  alerts: BudgetAlert[] = [];
  private usage: Usage = {};
  private usageFile: string;
  private configFile: string;
  private defaultScope: Scope;
  private writing: Promise<void> = Promise.resolve();

  constructor(configFile: string, usageFile: string, defaultScope: Scope) {
    this.configFile = configFile;
    this.usageFile = usageFile;
    this.defaultScope = defaultScope;
  }

  async load(): Promise<void> {
    try {
      this.config = JSON.parse(await readFile(this.configFile, "utf8")) as BudgetConfig;
    } catch {
      console.warn(`[gateway] no budgets file at ${this.configFile}; budgets are off`);
    }
    try {
      this.usage = JSON.parse(await readFile(this.usageFile, "utf8")) as Usage;
    } catch {
      this.usage = {};
    }
  }

  private limitFor(key: string): BudgetLimit | undefined {
    return this.config.keys[key] ?? this.config.keys["*"];
  }

  state(key: string, now = new Date()): BudgetState | null {
    const limit = this.limitFor(key);
    if (!limit) return null;
    const period = periodOf(this.config, now);
    const used = this.usage[`${period}|${key}`] ?? ZERO;
    const pct = limit.limit_ml > 0 ? Math.round((used.high / limit.limit_ml) * 1000) / 10 : 0;
    return { virtual_key: key, period, scope: limit.scope ?? this.defaultScope, limit_ml: limit.limit_ml, used_ml: used, used_pct: pct, status: statusFor(pct) };
  }

  /** Adds one request's water and returns the key's new state plus an alert if it crossed a threshold. */
  async record(key: string, waterByScope: Record<Scope, Range> | null, now = new Date()): Promise<{ state: BudgetState | null; alert?: BudgetAlert }> {
    const before = this.state(key, now);
    if (!before || !waterByScope) return { state: before };
    const slot = `${before.period}|${key}`;
    this.usage[slot] = addRange(this.usage[slot] ?? ZERO, waterByScope[before.scope]);
    // Read the new state before awaiting, so concurrent requests can't both claim the same crossing.
    const after = this.state(key, now)!;
    await this.persist();

    if (after.status !== before.status && after.status !== "ok") {
      const alert: BudgetAlert = { at: now.toISOString(), virtual_key: key, period: after.period, status: after.status, used_pct: after.used_pct };
      this.alerts.push(alert);
      return { state: after, alert };
    }
    return { state: after };
  }

  /** Writes go one at a time, each with the latest totals, so concurrent requests can't interleave a file. */
  private persist(): Promise<void> {
    // A failed write must not block the ones after it.
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.usageFile), { recursive: true });
      await writeFile(this.usageFile, JSON.stringify(this.usage, null, 2));
    });
    return this.writing;
  }

  all(now = new Date()): BudgetState[] {
    const keys = new Set(Object.keys(this.config.keys).filter((k) => k !== "*"));
    const period = periodOf(this.config, now);
    for (const slot of Object.keys(this.usage)) {
      const [p, k] = slot.split("|");
      if (p === period && k) keys.add(k);
    }
    return [...keys].map((k) => this.state(k, now)).filter((s): s is BudgetState => s !== null);
  }
}

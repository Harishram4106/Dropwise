"use client";

// The budget numbers the Budgets page shows.
// Live: the gateway's GET /budgets, re-read 400 ms after each new receipt and every 10 s as a backstop.
// Demo: rebuilt from the replayed receipts the way the gateway counts them, summing each request's
// high-end water against its key's limit, so a key can cross 80% and 100% while the demo plays.

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL, type BudgetAlert, type BudgetState, type BudgetsResponse, budgetStatus, type Range, type Receipt } from "@/lib/dropwise";
import { useConnection } from "./connection";

export interface BudgetsData {
  /** "2026-11-13" (a day) or "2026-11" (a month). */
  period: string | null;
  budgets: BudgetState[];
  /** Newest first. */
  alerts: BudgetAlert[];
  loaded: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Receipts carry their key's budget state, so the limits are known without asking the gateway. */
export function deriveBudgets(receiptsNewestFirst: Receipt[]): BudgetsData {
  const chronological = [...receiptsNewestFirst].reverse();
  const limits = new Map<string, NonNullable<Receipt["budget"]>>();
  for (const r of chronological) if (r.budget) limits.set(r.virtual_key, r.budget);

  const used = new Map<string, Range>();
  const status = new Map<string, BudgetState["status"]>();
  const alerts: BudgetAlert[] = [];
  for (const r of chronological) {
    const lim = limits.get(r.virtual_key);
    if (!lim) continue;
    const add = r.water_ml_by_scope?.[lim.scope];
    const before = used.get(r.virtual_key) ?? { low: 0, high: 0 };
    const now = add ? { low: before.low + add.low, high: before.high + add.high } : before;
    used.set(r.virtual_key, now);
    const pct = lim.limit_ml > 0 ? round1((now.high / lim.limit_ml) * 100) : 0;
    const next = budgetStatus(pct);
    const prev = status.get(r.virtual_key) ?? "ok";
    if (next !== prev && next !== "ok") alerts.push({ at: r.created_at, virtual_key: r.virtual_key, period: lim.period, status: next, used_pct: pct });
    status.set(r.virtual_key, next);
  }

  const budgets: BudgetState[] = [...limits.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, lim]) => {
      const u = used.get(key) ?? { low: 0, high: 0 };
      const pct = lim.limit_ml > 0 ? round1((u.high / lim.limit_ml) * 100) : 0;
      return { ...lim, used_ml: u, used_pct: pct, status: budgetStatus(pct) };
    });
  return { period: budgets[0]?.period ?? null, budgets, alerts: alerts.reverse(), loaded: receiptsNewestFirst.length > 0 };
}

export function useBudgets(receipts: Receipt[]): BudgetsData {
  const { status, fallBack } = useConnection();
  const [live, setLive] = useState<BudgetsData | null>(null);
  const demo = useMemo(() => (status === "demo" ? deriveBudgets(receipts) : null), [status, receipts]);
  const newest = receipts[0]?.request_id;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/budgets`, { cache: "no-store" });
      if (!res.ok) throw new Error(`budgets ${res.status}`);
      const body = (await res.json()) as BudgetsResponse;
      const budgets = [...body.budgets].sort((a, b) => a.virtual_key.localeCompare(b.virtual_key));
      setLive({ period: budgets[0]?.period ?? null, budgets, alerts: [...body.alerts].reverse(), loaded: true });
    } catch {
      fallBack("The gateway's budgets couldn't be loaded");
    }
  }, [fallBack]);

  useEffect(() => {
    if (status !== "live") return;
    const t = setTimeout(load, newest ? 400 : 0);
    return () => clearTimeout(t);
  }, [status, load, newest]);

  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [status, load]);

  if (status === "live") return live ?? { period: null, budgets: [], alerts: [], loaded: false };
  return demo ?? { period: null, budgets: [], alerts: [], loaded: false };
}

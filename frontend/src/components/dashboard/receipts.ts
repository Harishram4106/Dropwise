"use client";

// The receipt stream every dashboard page reads, newest first.
// Live: GET /receipts once, then new receipts from the GET /events stream.
// Demo: the saved receipts, the first ones spaced back from now, the rest replayed one by one (looping) as if live.

import { useEffect, useState } from "react";
import fixtures from "@/fixtures/receipts.json";
import { API_URL, type Receipt } from "@/lib/dropwise";
import { useConnection } from "./connection";

export const SAVED = fixtures.receipts as Receipt[];
const DEMO_START = 38;
const DEMO_EVERY_MS = 2600;

export interface ReceiptStream {
  /** Newest first. In demo mode every receipt so far; live, at most `limit` plus what arrived since. */
  receipts: Receipt[];
  /** Ids that arrived while the page was open, for the row highlight. */
  fresh: Set<string>;
  loaded: boolean;
}

export function useReceipts(limit: number): ReceiptStream {
  const { status, fallBack } = useConnection();
  const [state, setState] = useState<ReceiptStream>({ receipts: [], fresh: new Set(), loaded: false });

  useEffect(() => {
    if (status !== "demo") return;
    let next = DEMO_START;
    // Timers only: the first lays out the starting receipts; the rest arrive one by one.
    const first = setTimeout(() => {
      const now = Date.now();
      const start = SAVED.slice(0, DEMO_START).map((r, i) => ({ ...r, created_at: new Date(now - (DEMO_START - i) * 19_000).toISOString() }));
      setState({ receipts: start.reverse(), fresh: new Set(), loaded: true });
    }, 0);
    const t = setInterval(() => {
      const loop = Math.floor(next / SAVED.length);
      const src = SAVED[next % SAVED.length];
      const r = { ...src, request_id: loop ? `${src.request_id}-${loop}` : src.request_id, created_at: new Date().toISOString() };
      next++;
      setState((s) => ({ receipts: [r, ...s.receipts], fresh: new Set(s.fresh).add(r.request_id), loaded: true }));
    }, DEMO_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "live") return;
    let stopped = false;
    const arrived: Receipt[] = [];
    (async () => {
      try {
        const res = await fetch(`${API_URL}/receipts?limit=${limit}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`receipts ${res.status}`);
        const list: Receipt[] = await res.json();
        // Replace whatever was shown before (demo data, say), keeping what the event stream delivered meanwhile.
        if (!stopped) {
          const seen = new Set(arrived.map((r) => r.request_id));
          setState((s) => ({ ...s, receipts: [...arrived, ...list.filter((r) => !seen.has(r.request_id))], loaded: true }));
        }
      } catch {
        fallBack("The gateway's receipts couldn't be loaded");
      }
    })();
    const events = new EventSource(`${API_URL}/events`);
    events.addEventListener("receipt", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as Receipt;
      arrived.unshift(r);
      setState((s) => ({
        ...s,
        receipts: [r, ...s.receipts.filter((x) => x.request_id !== r.request_id)],
        fresh: new Set(s.fresh).add(r.request_id),
      }));
    });
    return () => {
      stopped = true;
      events.close();
    };
  }, [status, limit, fallBack]);

  return status === "connecting" ? { receipts: [], fresh: new Set(), loaded: false } : state;
}

/** The current time, ticking every second; 0 until mounted, so server and client render the same. */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return now;
}

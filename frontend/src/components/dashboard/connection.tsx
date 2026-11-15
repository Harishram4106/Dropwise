"use client";

// Decides, once for every dashboard page, whether data comes from the live gateway or from the saved demo
// fixtures: demo when NEXT_PUBLIC_DEMO_MODE=1 or ?demo=1, or when the gateway can't be reached (the plan's
// judging-day fallback). Pages call `fallBack` when a live call fails, so the whole dashboard switches together.

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import fixtures from "@/fixtures/receipts.json";
import { API_URL, DEMO_FORCED, type Health, type Scope, scopeFromParam } from "@/lib/dropwise";

type Status = "connecting" | "live" | "demo";

interface Connection {
  status: Status;
  /** Why demo data is showing, in plain words. */
  reason: string | null;
  health: Health | null;
  scope: Scope;
  /** Query string to carry across dashboard links (scope and demo). */
  query: string;
  fallBack: (reason: string) => void;
}

interface State {
  status: Status;
  reason: string | null;
  health: Health | null;
  sticky: boolean;
}

const Ctx = createContext<Connection | null>(null);

const DEMO_HEALTH: Health = { ok: true, intelligence: true, ...fixtures.health };
const FORCED: State = { status: "demo", reason: "Demo mode is on", health: DEMO_HEALTH, sticky: true };

async function ping(): Promise<Health> {
  const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const forced = DEMO_FORCED || params.get("demo") === "1";
  const scope = scopeFromParam(params.get("scope"));
  const [checked, setState] = useState<State>({ status: "connecting", reason: null, health: null, sticky: false });
  const state: State = forced ? FORCED : checked;

  // A page's failed call keeps the dashboard on demo data until reload, so it never flips back and forth mid-demo.
  const fallBack = useCallback(
    (reason: string) => setState((s) => (s.status === "demo" ? s : { status: "demo", reason, health: DEMO_HEALTH, sticky: true })),
    [],
  );

  useEffect(() => {
    if (forced) return;
    let stopped = false;
    const check = async () => {
      try {
        const health = await ping();
        if (!stopped) setState((s) => (s.sticky ? s : { status: "live", reason: null, health, sticky: false }));
      } catch {
        if (!stopped)
          setState((s) => (s.status === "demo" ? s : { status: "demo", reason: `The gateway isn't answering at ${API_URL}`, health: DEMO_HEALTH, sticky: false }));
      }
    };
    void check();
    // Keep checking, so the dashboard goes live once the gateway is started.
    const t = setInterval(check, 10_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [forced]);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (params.get("scope") === "direct") q.set("scope", "direct");
    if (params.get("demo") === "1") q.set("demo", "1");
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [params]);

  const value = useMemo(
    () => ({ status: state.status, reason: state.reason, health: state.health, scope, query, fallBack }),
    [state, scope, query, fallBack],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): Connection {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConnection must be used inside <ConnectionProvider>");
  return c;
}

"use client";

// The before / after benchmark and the answer-quality report.
// Live: the gateway's GET /benchmark/latest and the intelligence API's GET /eval/quality. Both return 404 before
// their first run; that is "not run yet", not an error. Demo: the saved benchmark (run through the real gateway with a
// stand-in model, so its tokens and latency are synthetic). No quality report is saved, because none has been run.

import { useEffect, useState } from "react";
import saved from "@/fixtures/benchmark.json";
import { API_URL, type BenchReport, INTELLIGENCE_URL, type QualityReport } from "@/lib/dropwise";
import { useConnection } from "./connection";

const SAVED = saved as unknown as BenchReport;

export type Loaded<T> = { state: "loading" } | { state: "none" } | { state: "ok"; report: T; demo: boolean };

/** The latest benchmark. `useSaved` lets a visitor view the saved demo run when no real run exists yet. */
export function useBenchmark(useSaved: boolean): Loaded<BenchReport> {
  const { status, fallBack } = useConnection();
  const [live, setLive] = useState<Loaded<BenchReport>>({ state: "loading" });

  useEffect(() => {
    if (status !== "live") return;
    let stopped = false;
    fetch(`${API_URL}/benchmark/latest`, { cache: "no-store" })
      .then(async (res) => {
        if (stopped) return;
        if (res.status === 404) return setLive({ state: "none" });
        if (!res.ok) throw new Error(String(res.status));
        setLive({ state: "ok", report: (await res.json()) as BenchReport, demo: false });
      })
      .catch(() => fallBack("The gateway's benchmark couldn't be loaded"));
    return () => {
      stopped = true;
    };
  }, [status, fallBack]);

  if (status === "demo") return { state: "ok", report: SAVED, demo: true };
  if (status === "connecting") return { state: "loading" };
  if (live.state === "none" && useSaved) return { state: "ok", report: SAVED, demo: true };
  return live;
}

export function useQuality(): Loaded<QualityReport> {
  const { status } = useConnection();
  const [live, setLive] = useState<Loaded<QualityReport>>({ state: "loading" });

  useEffect(() => {
    if (status !== "live") return;
    let stopped = false;
    fetch(`${INTELLIGENCE_URL}/eval/quality`, { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then(async (res) => {
        if (stopped) return;
        if (!res.ok) return setLive({ state: "none" });
        setLive({ state: "ok", report: (await res.json()) as QualityReport, demo: false });
      })
      // The intelligence API being unreachable is the same to a visitor as "no report": there is nothing to show.
      .catch(() => !stopped && setLive({ state: "none" }));
    return () => {
      stopped = true;
    };
  }, [status]);

  if (status === "demo") return { state: "none" };
  if (status === "connecting") return { state: "loading" };
  return live;
}
